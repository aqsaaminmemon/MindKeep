#include "core.hpp"
#include <algorithm>
#include <cmath>
#include <mutex>
#include <queue>
#include <regex>
#include <sstream>
#include <unicode/normalizer2.h>
#include <unicode/uchar.h>
#include <unicode/unistr.h>
#include <unicode/utf8.h>

namespace mk {
using namespace std;

std::string fold(const std::string &s) {
  int32_t p = 0;
  while (p < (int32_t)s.size()) {
    UChar32 c;
    U8_NEXT(s.data(), p, (int32_t)s.size(), c);
    if (c < 0)
      throw std::invalid_argument("Text contains invalid UTF-8");
  }
  UErrorCode error = U_ZERO_ERROR;
  auto norm = icu::Normalizer2::getNFCInstance(error);
  icu::UnicodeString normalized;
  norm->normalize(icu::UnicodeString::fromUTF8(s), normalized, error);
  if (U_FAILURE(error))
    throw std::runtime_error("Unicode normalization failed");
  normalized.foldCase();
  std::string out;
  normalized.toUTF8String(out);
  return out;
}

std::vector<std::string> tokenize(const std::string &s) {
  auto t = fold(s);
  std::vector<std::string> out;
  std::string token;
  int32_t p = 0;
  while (p < (int32_t)t.size()) {
    int32_t start = p;
    UChar32 c;
    U8_NEXT(t.data(), p, (int32_t)t.size(), c);
    auto type = u_charType(c);
    if (u_isalnum(c) || (type == U_NON_SPACING_MARK && !token.empty()) ||
        type == U_COMBINING_SPACING_MARK)
      token += t.substr(start, p - start);
    else if (!token.empty()) {
      out.push_back(token);
      token.clear();
    }
  }
  if (!token.empty()) {
    out.push_back(token);
  }
  return out;
}

static long long date_value(const std::string &s) {
  if (!std::regex_match(s, std::regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")))
    throw std::invalid_argument("Dates must use YYYY-MM-DD (UTC modification date)");
  std::tm tm{};
  std::istringstream in(s);
  in >> std::get_time(&tm, "%Y-%m-%d");
  if (in.fail())
    throw std::invalid_argument("Invalid date");
  auto copy = tm;
  auto value = timegm(&copy);
  char buf[11];
  strftime(buf, sizeof(buf), "%Y-%m-%d", &copy);
  if (s != buf)
    throw std::invalid_argument("Invalid calendar date");
  return (long long)value * 1000;
}

Query parse_query(const std::string &input, const json &filters) {
  Query q;
  if (!filters.is_object())
    throw std::invalid_argument("Invalid filters");
  q.folder = filters.value("folder", "");
  q.tag = filters.value("tag", "");
  q.state = filters.value("state", "active");
  q.scope = filters.value("scope", "all");
  if (filters.contains("before") && !filters["before"].get<std::string>().empty())
    q.before = date_value(filters["before"]);
  if (filters.contains("after") && !filters["after"].get<std::string>().empty())
    q.after = date_value(filters["after"]);
  std::string s = input;
  for (auto quote : {std::string("“"), std::string("”")}) {
    size_t p;
    while ((p = s.find(quote)) != std::string::npos)
      s.replace(p, quote.size(), "\"");
  }
  std::set<std::string> conditions;
  size_t p = 0;
  while (p < s.size()) {
    while (p < s.size() && std::isspace((unsigned char)s[p]))
      p++;
    if (p == s.size())
      break;
    std::string key, value;
    auto start = p;
    while (p < s.size() && !std::isspace((unsigned char)s[p]) && s[p] != ':' && s[p] != '\"')
      p++;
    if (p < s.size() && s[p] == ':') {
      key = s.substr(start, p - start);
      p++;
    } else
      p = start;
    bool quoted = p < s.size() && s[p] == '\"';
    if (quoted) {
      p++;
      auto e = s.find('"', p);
      if (e == std::string::npos)
        throw std::invalid_argument("Unclosed quoted phrase");
      value = s.substr(p, e - p);
      p = e + 1;
      if (p < s.size() && !std::isspace((unsigned char)s[p]))
        throw std::invalid_argument("Add a space after a quoted value");
    } else {
      auto a = p;
      while (p < s.size() && !std::isspace((unsigned char)s[p]))
        p++;
      value = s.substr(a, p - a);
    }
    if (value.empty())
      throw std::invalid_argument("Search condition needs a value");
    if (!key.empty()) {
      if (!conditions.insert(key).second)
        throw std::invalid_argument("Use each search condition only once: " + key);
      if (key == "tag")
        q.tag = value;
      else if (key == "folder")
        q.folder = value;
      else if (key == "before")
        q.before = date_value(value);
      else if (key == "after")
        q.after = date_value(value);
      else if (key == "state")
        q.state = value;
      else
        throw std::invalid_argument("Unknown search condition: " + key);
    } else {
      auto tokens = tokenize(value);
      if (tokens.empty())
        throw std::invalid_argument("Search needs letters or numbers");
      if (quoted)
        q.phrases.push_back(tokens);
      else
        q.terms.insert(q.terms.end(), tokens.begin(), tokens.end());
    }
  }
  if (!std::set<std::string>{"active", "all", "archived", "trash", "favorites", "pinned", "locked"}
           .contains(q.state))
    throw std::invalid_argument("Unknown note state");
  if (q.scope != "all" && q.scope != "title")
    throw std::invalid_argument("Unknown search scope");
  if (q.before && q.after && q.after >= q.before)
    throw std::invalid_argument("After date must precede before date");
  return q;
}

void SearchIndex::remove(Library &l, const std::string &id) {
  auto i = l.docs.find(id);
  if (i == l.docs.end())
    return;
  auto d = i->second;
  auto tokens = tokenize(d.title + " " + d.body);
  for (auto &t : tokens) {
    auto it = l.terms.find(t);
    if (it != l.terms.end()) {
      it->second.erase(id);
      if (it->second.empty())
        l.terms.erase(it);
    }
  }
  for (auto *groups : {&l.folders, &l.tags, &l.states})
    for (auto it = groups->begin(); it != groups->end();) {
      it->second.erase(id);
      if (it->second.empty())
        it = groups->erase(it);
      else
        ++it;
    }
  auto date = l.dates.find(d.updated);
  if (date != l.dates.end()) {
    date->second.erase(id);
    if (date->second.empty())
      l.dates.erase(date);
  }
  auto *node = &l.titles;
  node->ids.erase(id);
  auto title = fold(d.title);
  for (unsigned char c : title) {
    auto child = node->children.find(c);
    if (child == node->children.end())
      break;
    node = child->second.get();
    node->ids.erase(id);
  }
  l.docs.erase(i);
}

void SearchIndex::insert(Library &l, Document d) {
  remove(l, d.id);
  auto title = tokenize(d.title), body = tokenize(d.body);
  for (size_t p = 0; p < title.size(); p++)
    l.terms[title[p]][d.id].title.push_back(p);
  for (size_t p = 0; p < body.size(); p++)
    l.terms[body[p]][d.id].body.push_back(p);
  auto *node = &l.titles;
  node->ids.insert(d.id);
  for (unsigned char c : fold(d.title)) {
    if (!node->children[c])
      node->children[c] = std::make_unique<Trie>();
    node = node->children[c].get();
    node->ids.insert(d.id);
  }
  l.folders[fold(d.folder)].insert(d.id);
  for (auto &t : d.tags)
    l.tags[fold(t)].insert(d.id);
  l.dates[d.updated].insert(d.id);
  l.states[d.deleted ? "trash" : d.archived ? "archived" : "active"].insert(d.id);
  if (d.favorite)
    l.states["favorites"].insert(d.id);
  if (d.pinned)
    l.states["pinned"].insert(d.id);
  if (d.locked)
    l.states["locked"].insert(d.id);
  l.docs[d.id] = std::move(d);
}

void SearchIndex::upsert(Document d) {
  std::unique_lock lock(mutex);
  auto owner = d.owner;
  insert(users[owner], std::move(d));
}

void SearchIndex::erase(const std::string &owner, const std::string &id) {
  std::unique_lock lock(mutex);
  auto i = users.find(owner);
  if (i != users.end())
    remove(i->second, id);
}

void SearchIndex::rebuild(const std::vector<Document> &docs) {
  std::unordered_map<std::string, Library> replacement;
  for (auto d : docs) {
    auto owner = d.owner;
    insert(replacement[owner], std::move(d));
  }
  std::unique_lock lock(mutex);
  users.swap(replacement);
}

static bool phrase_match(const std::vector<std::vector<int>> &positions) {
  if (positions.empty())
    return false;
  for (auto first : positions.front()) {
    bool match = true;
    for (size_t i = 1; i < positions.size(); i++)
      if (!std::binary_search(positions[i].begin(), positions[i].end(), first + (int)i)) {
        match = false;
        break;
      }
    if (match)
      return true;
  }
  return false;
}

std::vector<Hit> SearchIndex::search(const std::string &owner, const Query &q,
                                     const std::set<std::string> &unlocked) const {
  std::shared_lock lock(mutex);
  auto user = users.find(owner);
  if (user == users.end())
    return {};
  auto &l = user->second;
  // Start from the smallest indexed filter rather than copying every note ID.
  std::vector<const std::set<std::string> *> restrictions;
  const std::set<std::string> empty;
  auto group = [&](const auto &map, const std::string &name) {
    auto i = map.find(name);
    restrictions.push_back(i == map.end() ? &empty : &i->second);
  };
  if (q.state != "all")
    group(l.states, q.state);
  if (!q.folder.empty())
    group(l.folders, fold(q.folder));
  if (!q.tag.empty())
    group(l.tags, fold(q.tag));
  std::set<std::string> date_ids;
  if (q.before || q.after) {
    auto begin = q.after ? l.dates.lower_bound(q.after) : l.dates.begin(),
         end = q.before ? l.dates.lower_bound(q.before) : l.dates.end();
    for (auto i = begin; i != end; ++i)
      date_ids.insert(i->second.begin(), i->second.end());
    restrictions.push_back(&date_ids);
  }
  // A selective word/phrase can be much smaller than the active-note collection.
  size_t smallest = l.docs.size() + 1;
  for (auto ids : restrictions)
    smallest = std::min(smallest, ids->size());
  std::string seed_prefix;
  for (auto &term : q.terms) {
    size_t count = 0;
    for (auto i = l.terms.lower_bound(term); i != l.terms.end() && i->first.starts_with(term); ++i)
      count += i->second.size();
    if (count < smallest) {
      smallest = count;
      seed_prefix = term;
    }
  }
  const std::unordered_map<std::string, Posting> *phrase_seed = nullptr;
  for (auto &phrase : q.phrases)
    for (auto &term : phrase) {
      auto i = l.terms.find(term);
      if (i == l.terms.end())
        return {};
      if (i->second.size() < smallest) {
        smallest = i->second.size();
        phrase_seed = &i->second;
      }
    }
  std::set<std::string> word_ids;
  if (phrase_seed) {
    for (auto &[id, posting] : *phrase_seed)
      if (q.scope != "title" || !posting.title.empty())
        word_ids.insert(id);
    restrictions.push_back(&word_ids);
  } else if (!seed_prefix.empty()) {
    for (auto i = l.terms.lower_bound(seed_prefix);
         i != l.terms.end() && i->first.starts_with(seed_prefix); ++i)
      for (auto &[id, posting] : i->second)
        if (q.scope != "title" || !posting.title.empty())
          word_ids.insert(id);
    restrictions.push_back(&word_ids);
  }
  std::sort(restrictions.begin(), restrictions.end(),
            [](auto a, auto b) { return a->size() < b->size(); });
  std::set<std::string> candidates;
  const auto &seed = restrictions.empty() ? l.titles.ids : *restrictions.front();
  for (auto &id : seed) {
    const auto &d = l.docs.at(id);
    if ((d.locked && !unlocked.contains(id)) || (d.deleted && q.state != "trash"))
      continue;
    if (std::all_of(restrictions.begin(), restrictions.end(),
                    [&](auto ids) { return ids->contains(id); }))
      candidates.insert(id);
  }
  if (candidates.empty())
    return {};
  auto intersect = [&](const std::set<std::string> &ids) {
    std::set<std::string> result;
    const auto &smaller = candidates.size() <= ids.size() ? candidates : ids;
    const auto &larger = candidates.size() <= ids.size() ? ids : candidates;
    for (auto &id : smaller)
      if (larger.contains(id))
        result.insert(id);
    candidates.swap(result);
  };
  using Frequencies = std::pair<size_t, size_t>;
  std::unordered_map<std::string, std::unordered_map<std::string, Frequencies>> term_matches;
  for (auto &term : q.terms) {
    std::set<std::string> ids;
    auto &matches = term_matches[term];
    // Expand only vocabulary entries starting with the typed word.
    for (auto i = l.terms.lower_bound(term); i != l.terms.end() && i->first.starts_with(term);
         ++i) {
      for (auto &[id, posting] : i->second) {
        if (!candidates.contains(id) || (q.scope == "title" && posting.title.empty()))
          continue;
        auto &frequency = matches[id];
        frequency.first += posting.title.size();
        frequency.second += posting.body.size();
        ids.insert(id);
      }
    }
    // Prefixes of the complete title are supported independently of body terms.
    auto *node = &l.titles;
    bool found = true;
    for (unsigned char c : term) {
      auto next = node->children.find(c);
      if (next == node->children.end()) {
        found = false;
        break;
      }
      node = next->second.get();
    }
    if (found)
      ids.insert(node->ids.begin(), node->ids.end());
    intersect(ids);
    if (candidates.empty())
      return {};
  }
  for (auto &phrase : q.phrases) {
    // Narrow phrase candidates using the rarest complete word before checking positions.
    const std::unordered_map<std::string, Posting> *rarest = nullptr;
    for (auto &term : phrase) {
      auto i = l.terms.find(term);
      if (i == l.terms.end())
        return {};
      if (!rarest || i->second.size() < rarest->size())
        rarest = &i->second;
    }
    if (rarest) {
      std::set<std::string> ids;
      for (auto &[id, posting] : *rarest)
        if (candidates.contains(id) && (q.scope != "title" || !posting.title.empty()))
          ids.insert(id);
      intersect(ids);
    }
    std::set<std::string> matches;
    for (auto &id : candidates) {
      std::vector<std::vector<int>> tp, bp;
      bool found = true;
      for (auto &term : phrase) {
        auto i = l.terms.find(term);
        if (i == l.terms.end() || !i->second.contains(id)) {
          found = false;
          break;
        }
        auto &posting = i->second.at(id);
        tp.push_back(posting.title);
        bp.push_back(posting.body);
      }
      if (found && (phrase_match(tp) || (q.scope != "title" && phrase_match(bp))))
        matches.insert(id);
    }
    intersect(matches);
    if (candidates.empty())
      return {};
  }
  std::unordered_map<std::string, double> weights;
  auto locked = l.states.find("locked");
  double total = l.docs.size() - (locked == l.states.end() ? 0 : locked->second.size());
  if (locked != l.states.end())
    for (auto &id : unlocked)
      if (locked->second.contains(id))
        total++;
  for (auto &term : q.terms) {
    double df = 0;
    for (auto &[did, frequency] : term_matches.at(term))
      if (!l.docs.at(did).locked || unlocked.contains(did))
        df++;
    weights[term] = 1 + std::log((total + 1) / (df + 1));
  }
  // Highest score first; equal scores retain the original ascending-ID order.
  auto lower_priority = [](const Hit &a, const Hit &b) {
    return a.score != b.score ? a.score < b.score : a.id > b.id;
  };
  priority_queue<Hit, vector<Hit>, decltype(lower_priority)> ranked(lower_priority);
  for (auto &id : candidates) {
    auto &d = l.docs.at(id);
    double score = 0;
    for (auto &term : q.terms) {
      auto &matches = term_matches.at(term);
      auto i = matches.find(id);
      if (i != matches.end()) {
        double tf = i->second.first, bf = i->second.second;
        double idf = weights.at(term);
        score += idf * (3 * tf / (tf + 1) + (q.scope == "title" ? 0 : bf / (bf + 1)));
      }
      if (fold(d.title).starts_with(term))
        score += 2;
    }
    score += q.phrases.size() * 4;
    auto text = d.body;
    size_t start = 0;
    auto folded = fold(text);
    auto snippet_terms = q.terms;
    if (snippet_terms.empty() && !q.phrases.empty())
      snippet_terms = q.phrases.front();
    for (auto &term : snippet_terms) {
      auto p = folded.find(term);
      if (p != std::string::npos) {
        start = p > 50 ? p - 50 : 0;
        break;
      }
    }
    while (start < text.size() && ((unsigned char)text[start] & 0xc0) == 0x80)
      start++;
    size_t end = std::min(start + 220, text.size());
    while (end < text.size() && ((unsigned char)text[end] & 0xc0) == 0x80)
      end++;
    auto snippet = text.substr(start, end - start);
    if (start)
      snippet = "…" + snippet;
    if (end < text.size())
      snippet += "…";
    ranked.push({id, snippet, score});
  }
  vector<Hit> hits;
  hits.reserve(ranked.size());
  while (!ranked.empty()) {
    hits.push_back(ranked.top());
    ranked.pop();
  }
  return hits;
}

size_t SearchIndex::memory_bytes() const {
  std::shared_lock lock(mutex);
  size_t n = 0;
  for (auto &[owner, l] : users) {
    n += owner.capacity();
    for (auto &[id, d] : l.docs)
      n += sizeof(d) + id.capacity() + d.id.capacity() + d.owner.capacity() + d.title.capacity() +
           d.body.capacity() + d.folder.capacity();
    for (auto &[term, postings] : l.terms) {
      n += sizeof(postings) + term.capacity();
      for (auto &[id, p] : postings)
        n += sizeof(p) + id.capacity() + (p.title.capacity() + p.body.capacity()) * sizeof(int);
    }
    std::function<void(const Trie &)> count = [&](const Trie &t) {
      n += sizeof(Trie);
      for (auto &id : t.ids)
        n += sizeof(std::string) + id.capacity() + 3 * sizeof(void *);
      for (auto &[c, child] : t.children) {
        n += sizeof(c) + sizeof(void *) * 3;
        count(*child);
      }
    };
    count(l.titles);
    for (auto *groups : {&l.folders, &l.tags, &l.states})
      for (auto &[key, ids] : *groups) {
        n += key.capacity() + sizeof(ids);
        for (auto &id : ids)
          n += sizeof(std::string) + id.capacity() + 3 * sizeof(void *);
      }
    for (auto &[date, ids] : l.dates)
      n +=
          sizeof(date) + sizeof(ids) + ids.size() * (sizeof(std::string) + 36 + 3 * sizeof(void *));
  }
  return n;
}
} // namespace mk
