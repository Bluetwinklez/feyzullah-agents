# Uzmanlar

Her `.md` dosyası bir uzman. Ön bilgi alanları: `id`, `name`, `department` (build, design, grow, make, run), `role`, `engine` (codex, claude, antigravity), isteğe bağlı `model`, `reports_to`, `capabilities`, `skills`, `keywords`. Gövde uzmanın kimlik metnidir.

Çalışma alanına özel uzmanlar `.feyzullah-agents/agents/` altına konur; aynı `id` buradakini ezer. `fa agents --sync` ile veritabanına alınır.
