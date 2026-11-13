# scrapling-fetch.py — fallback de enriquecimento com Scrapling
#
# Somente ADITIVO ao gerar-fila.mjs: o fetch nativo do Node continua sendo
# a primeira tentativa. Este CLI só é chamado quando o site bloqueia o
# fetch básico (Cloudflare/403/amber), trazendo stealth TLS via curl-cffi.
#
# Uso:
#   python scrapling-fetch.py <url> <padroes-json>
#     <padroes-json> = [["regex", "label descriptiva"], ...]
# Saída (stdout, JSON):
#   {"status": 200, "title": "...", "flags": [...], "http": false}
#   {"status": 403, "erro": "site bloqueou", "via": "scrapling"}
import json
import re
import sys

from scrapling import Fetcher


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"erro": "uso: scrapling-fetch.py <url> [padroes]"}))
        return 2
    url = sys.argv[1]
    padroes = []
    if len(sys.argv) > 2:
        try:
            padroes = json.loads(sys.argv[2])
        except Exception:
            padroes = []

    try:
        page = Fetcher.get(url)
    except Exception as e:
        print(json.dumps({"erro": f"site inacessível: {type(e).__name__}", "via": "scrapling"}))
        return 1

    status = page.status or 0
    if status >= 400:
        print(json.dumps({"status": status, "erro": "site bloqueou/errou", "via": "scrapling"}))
        return 1

    html_original = page.html_content or ""
    html = html_original.lower()
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html_original)
    title = title_match.group(1).strip() if title_match else ""

    flags = []
    for padrao, rotulo in padroes:
        try:
            if re.search(padrao, html):
                flags.append(rotulo)
        except re.error:
            continue

    print(json.dumps({
        "status": status,
        "title": title,
        "flags": flags,
        "http": not url.lower().startswith("https://"),
        "via": "scrapling",
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
