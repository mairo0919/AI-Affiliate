# Security (P8)

- Bearer session（hash 保存）+ login brute-force window
- Rate limit / security headers / CORS 制限
- production で CORS *・default bootstrap password 禁止
- SSRF: localhost / private / metadata 拒否（`assertSafeOutboundUrl`）
- CSV formula injection sanitize
- secrets 非露出（configured only）
- stack trace を本番レスポンスに出さない
- HTML/public body sanitizer（既存）
