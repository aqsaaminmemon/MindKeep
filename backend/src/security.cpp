#include "core.hpp"
#include "entities.hpp"
#include <iomanip>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <regex>
#include <sstream>
#include <stack>
#include <unicode/unistr.h>

namespace mk {
using namespace std;

std::string random_hex(size_t bytes) {
  std::vector<unsigned char> b(bytes);
  if (RAND_bytes(b.data(), b.size()) != 1)
    throw std::runtime_error("Random generator failed");
  std::ostringstream o;
  for (auto c : b)
    o << std::hex << std::setw(2) << std::setfill('0') << (int)c;
  return o.str();
}

std::string sha256(const std::string &s) {
  unsigned char b[32];
  unsigned int n = 0;
  EVP_Digest(s.data(), s.size(), b, &n, EVP_sha256(), nullptr);
  std::ostringstream o;
  for (unsigned int i = 0; i < n; i++)
    o << std::hex << std::setw(2) << std::setfill('0') << (int)b[i];
  return o.str();
}

std::string base64(const std::string &s) {
  std::string out(4 * ((s.size() + 2) / 3), '\0');
  EVP_EncodeBlock((unsigned char *)out.data(), (const unsigned char *)s.data(), s.size());
  return out;
}

std::string unbase64(const std::string &s) {
  if (s.size() % 4 || s.size() > 70 * 1024 * 1024 ||
      !std::regex_match(s, std::regex("[A-Za-z0-9+/]*={0,2}")))
    throw std::runtime_error("Invalid base64");
  if (s.empty())
    return {};
  std::string out(s.size() / 4 * 3, '\0');
  int n = EVP_DecodeBlock((unsigned char *)out.data(), (const unsigned char *)s.data(), s.size());
  if (n < 0)
    throw std::runtime_error("Invalid base64");
  if (s.back() == '=')
    n--;
  if (s.size() > 1 && s[s.size() - 2] == '=')
    n--;
  out.resize(n);
  return out;
}

static std::string derive(const std::string &p, const std::string &salt, int iterations) {
  unsigned char key[32];
  if (PKCS5_PBKDF2_HMAC(p.data(), p.size(), (const unsigned char *)salt.data(), salt.size(),
                        iterations, EVP_sha256(), 32, key) != 1)
    throw std::runtime_error("Password hashing failed");
  return base64(std::string((char *)key, 32));
}

std::string password_hash(const std::string &s) {
  auto salt = random_hex();
  return "pbkdf2$600000$" + salt + "$" + derive(s, salt, 600000);
}

bool password_verify(const std::string &p, const std::string &encoded) {
  try {
    std::vector<std::string> a;
    std::stringstream stream(encoded);
    std::string v;
    while (std::getline(stream, v, '$'))
      a.push_back(v);
    if (a.size() != 4 || a[0] != "pbkdf2" || a[1] != "600000")
      return false;
    auto actual = derive(p, a[2], 600000);
    return actual.size() == a[3].size() &&
           CRYPTO_memcmp(actual.data(), a[3].data(), actual.size()) == 0;
  } catch (...) {
    return false;
  }
}

std::string escape_html(const std::string &s) {
  std::string r;
  for (char c : s) {
    if (c == '&')
      r += "&amp;";
    else if (c == '<')
      r += "&lt;";
    else if (c == '>')
      r += "&gt;";
    else if (c == '\"')
      r += "&quot;";
    else
      r += c;
  }
  return r;
}

// Parse a strict subset. No links, external media, CSS URLs, scripts, event handlers, or arbitrary
// attributes.
std::string sanitize_html(const std::string &html) {
  if (html.size() > 1024 * 1024)
    throw std::runtime_error("Note exceeds 1 MiB");
  static const std::set<std::string> allowed = {
      "p",  "div", "br", "b",  "strong", "i",  "em",   "u",    "s",         "strike",
      "h1", "h2",  "h3", "ul", "ol",     "li", "span", "font", "blockquote"};
  std::string out;
  size_t pos = 0;
  std::regex name("^/?\\s*([A-Za-z0-9]+)");
  std::regex attr("([a-zA-Z-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))");
  while (pos < html.size()) {
    if (html[pos] != '<') {
      auto end = html.find('<', pos);
      if (end == std::string::npos)
        end = html.size();
      out += html.substr(pos, end - pos);
      pos = end;
      continue;
    }
    auto end = html.find('>', pos);
    if (end == std::string::npos) {
      out += "&lt;";
      pos++;
      continue;
    }
    auto tag = html.substr(pos + 1, end - pos - 1);
    std::smatch m;
    pos = end + 1;
    if (!std::regex_search(tag, m, name))
      continue;
    auto n = m[1].str();
    std::transform(n.begin(), n.end(), n.begin(), [](unsigned char c) { return std::tolower(c); });
    if (!allowed.contains(n))
      continue;
    bool close = !tag.empty() && tag[0] == '/';
    out += "<" + (close ? std::string("/") : std::string()) + n;
    if (!close)
      for (std::sregex_iterator i(tag.begin(), tag.end(), attr), last; i != last; ++i) {
        auto k = (*i)[1].str();
        auto v = (*i)[2].matched ? (*i)[2].str() : (*i)[3].matched ? (*i)[3].str() : (*i)[4].str();
        if (k == "data-checked" && (v == "true" || v == "false"))
          out += " data-checked=\"" + v + "\"";
        if (k == "color" && std::regex_match(v, std::regex("#[A-Fa-f0-9]{6}")))
          out += " color=\"" + v + "\"";
        if (k == "size" && std::regex_match(v, std::regex("[1-7]")))
          out += " size=\"" + v + "\"";
        if (k == "face" && (v == "Poppins" || v == "Garamond" || v == "Arial" || v == "Georgia" ||
                            v == "Verdana" || v == "monospace"))
          out += " face=\"" + v + "\"";
        if (k == "style") {
          std::string safe;
          std::stringstream ss(v);
          std::string part;
          while (std::getline(ss, part, ';')) {
            std::smatch style;
            if (std::regex_match(part, style,
                                 std::regex("\\s*(color|background-color)\\s*:\\s*(#[a-fA-F0-9]{6}|"
                                            "rgb\\([0-9 ,]{1,20}\\))\\s*")))
              safe += style[1].str() + ":" + style[2].str() + ";";
            if (std::regex_match(part, style,
                                 std::regex("\\s*font-family\\s*:\\s*(Poppins|Garamond|Arial|"
                                            "Georgia|Verdana|monospace)\\s*")))
              safe += "font-family:" + style[1].str() + ";";
            if (std::regex_match(part, style,
                                 std::regex("\\s*font-size\\s*:\\s*(12|14|16|18|20|24|32)px\\s*")))
              safe += "font-size:" + style[1].str() + "px;";
          }
          if (!safe.empty())
            out += " style=\"" + safe + "\"";
        }
      }
    out += ">";
  }
  return out;
}

std::string plain_text(const std::string &html) {
  auto s = std::regex_replace(
      html, std::regex("<(br\\s*/?|/(p|div|li|h[123]|blockquote))>", std::regex::icase), "\n");
  s = std::regex_replace(s, std::regex("<[^>]*>"), "");
  std::regex pattern("&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);");
  std::string result;
  size_t offset = 0;
  for (std::sregex_iterator it(s.begin(), s.end(), pattern), end; it != end; ++it) {
    result += s.substr(offset, it->position() - offset);
    auto name = (*it)[1].str();
    std::string decoded;
    if (name[0] == '#') {
      try {
        auto cp =
            std::stoul(name.substr(name[1] == 'x' ? 2 : 1), nullptr, name[1] == 'x' ? 16 : 10);
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp == 0)
          cp = 0xfffd;
        icu::UnicodeString value;
        value.append((UChar32)cp);
        value.toUTF8String(decoded);
      } catch (...) {
        decoded = it->str();
      }
    } else {
      auto entity = html_entities().find(name);
      decoded = entity == html_entities().end() ? it->str() : entity->second;
    }
    result += decoded;
    offset = it->position() + it->length();
  }
  result += s.substr(offset);
  return result;
}

std::string markdown(const std::string &html) {
  auto s = html;
  for (auto [tag, mark] : std::vector<std::pair<std::string, std::string>>{
           {"b", "**"}, {"strong", "**"}, {"i", "*"}, {"em", "*"}, {"s", "~~"}, {"strike", "~~"}}) {
    s = std::regex_replace(s, std::regex("</?" + tag + ">", std::regex::icase), mark);
  }
  for (int i = 1; i <= 3; i++)
    s = std::regex_replace(s, std::regex("<h" + std::to_string(i) + ">", std::regex::icase),
                           std::string(i, '#') + " ");
  s = std::regex_replace(s, std::regex("<li[^>]*data-checked=\"true\"[^>]*>"), "- [x] ");
  s = std::regex_replace(s, std::regex("<li[^>]*data-checked=\"false\"[^>]*>"), "- [ ] ");
  std::regex list_tags("<(/?)(ol|ul|li)([^>]*)>", std::regex::icase);
  // LIFO nesting state: closing a list restores its parent numbering.
  stack<pair<std::string, int>, vector<pair<std::string, int>>> lists;
  std::string rendered;
  size_t offset = 0;
  for (std::sregex_iterator it(s.begin(), s.end(), list_tags), end; it != end; ++it) {
    rendered += s.substr(offset, it->position() - offset);
    auto closing = (*it)[1].str(), tag = (*it)[2].str(), attributes = (*it)[3].str();
    if (tag == "ol" || tag == "ul") {
      if (closing.empty())
        lists.push({tag, 1});
      else if (!lists.empty())
        lists.pop();
    } else if (closing.empty()) {
      rendered += std::string(lists.size() > 1 ? (lists.size() - 1) * 2 : 0, ' ');
      rendered += !lists.empty() && lists.top().first == "ol"
                      ? std::to_string(lists.top().second++) + ". "
                      : "- ";
    } else
      rendered += "</li>";
    offset = it->position() + it->length();
  }
  rendered += s.substr(offset);
  return plain_text(rendered);
}
} // namespace mk
