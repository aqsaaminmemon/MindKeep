# Dependency choices and attribution

- **cpp-httplib 0.18.3**, copyright 2024 Yuji Hirose, MIT: a compact header-only HTTP server with route/multipart support, keeping the backend wholly C++ and understandable. Vendored in `httplib.h`.
- **nlohmann/json 3.11.3**, copyright 2013–2023 Niels Lohmann, MIT: typed JSON parsing/serialization with exceptions; not a database or search replacement. Vendored in `nlohmann/json.hpp`.
- **MySQL C client**: the native prepared-statement interface, transactions and ownership-constrained schema. Installed/extracted as an environment dependency; not vendored in source.
- **OpenSSL**: cryptographic randomness, PBKDF2, SHA-256, constant-time comparison and base64. No home-grown password hash.
- **ICU**: UTF-8 validation, NFC normalization, full case folding and Unicode character classes. Retrieval/ranking/indexing remain custom C++.
- **HTML5 entity-name data**: `backend/include/entities.hpp` is generated from Python's standard HTML5 entity-name mapping (Python stdlib `html.entities`); lookup is compiled into C++ and has no Python runtime dependency.
- **Chromium-based browser**: real PDF rendering with Unicode/layout/pagination, launched by C++; no substitute backend service. Browser executable is configurable.
- **fake-indexeddb 6.2.4 / Prettier 3.6.2 / clang-format 21**: optional development/test/formatting tools only. Not required to serve the app or included in product frontend bundles.

The frontend intentionally uses native DOM/contenteditable, Web Crypto, IndexedDB, MediaRecorder and the service-worker API rather than a framework. This keeps the capture flow fast, buildless and understandable. Native `execCommand` editing is deprecated but supported in the verified browser; cross-browser editor coverage is a documented verification limit. It supplies formatting-aware undo/redo without replacing the project's C++ architecture.

## MIT license for the two vendored header libraries

Copyright (c) 2024 Yuji Hirose.
Copyright (c) 2013–2023 Niels Lohmann.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
