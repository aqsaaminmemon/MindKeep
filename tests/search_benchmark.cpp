#include "core.hpp"
#include <algorithm>
#include <iostream>
using namespace mk;

int main() {
  std::cout << "notes,index_ms,p50_ms,p95_ms,approx_bytes\n";
  for (int n : {100, 1000, 10000}) {
    std::vector<Document> docs;
    for (int i = 0; i < n; i++) {
      Document d;
      d.id = std::to_string(i);
      d.owner = "benchmark";
      d.title = "Thought " + std::to_string(i);
      d.body = "Remember to get fresh bread and flowers on the weekend. Idea category " +
               std::to_string(i % 100);
      d.tags = {"category" + std::to_string(i % 10)};
      d.updated = 1735689600000 + i;
      docs.push_back(d);
    }
    SearchIndex index;
    auto start = std::chrono::steady_clock::now();
    index.rebuild(docs);
    auto ms = [](auto start) {
      return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start)
          .count();
    };
    double indexing = ms(start);
    std::vector<double> samples;
    for (int i = 0; i < 100; i++) {
      auto q =
          parse_query(i % 2 ? "\"fresh bread\" tag:category3" : "weekend flowers tag:category7");
      start = std::chrono::steady_clock::now();
      auto hits = index.search("benchmark", q);
      samples.push_back(ms(start));
    }
    std::sort(samples.begin(), samples.end());
    std::cout << n << "," << indexing << "," << samples[50] << "," << samples[95] << ","
              << index.memory_bytes() << "\n";
  }
}
