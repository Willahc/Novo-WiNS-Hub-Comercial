#!/usr/bin/env python3
"""Consulta rápida na base local cnpj-sp.db por CNAE + Município (SP) + filtro MEI."""
import json
import sqlite3
import sys
import unicodedata
from pathlib import Path

DB_PATH = Path("/root/wins-hub/data/cnpj-sp.db")


def norm_text(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.upper().strip().split())


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if not DB_PATH.exists():
        print(json.dumps({"ok": True, "ready": False, "status": "not_started", "progress": "Base ainda não importada"}))
        return

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta").fetchall()}

    if cmd == "status":
        print(json.dumps({
            "ok": True,
            "ready": meta.get("status") == "ready",
            "status": meta.get("status", "unknown"),
            "competencia": meta.get("competencia", ""),
            "progress": meta.get("progress", ""),
            "total_sp": int(meta.get("total_sp") or 0),
            "total_mei": int(meta.get("total_mei") or 0),
        }))
        return

    if cmd == "search":
        payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        if meta.get("status") != "ready":
            print(json.dumps({"ok": False, "error": f"Base CNAE SP ainda importando: {meta.get('progress', '')}"}))
            return

        cnae_raw = "".join(c for c in str(payload.get("cnae", "")) if c.isdigit())
        cidade_raw = str(payload.get("cidade", "São Paulo")).split(",")[0].split("-")[0].strip()
        mei_only = bool(payload.get("meiOnly", True))
        limit = min(200, max(1, int(payload.get("limit", 60))))

        mun_row = conn.execute(
            "SELECT codigo, nome FROM municipios WHERE nome_norm = ? LIMIT 1",
            (norm_text(cidade_raw),),
        ).fetchone()
        if not mun_row:
            mun_row = conn.execute(
                "SELECT codigo, nome FROM municipios WHERE nome_norm LIKE ? LIMIT 1",
                (f"%{norm_text(cidade_raw)}%",),
            ).fetchone()
        if not mun_row:
            print(json.dumps({"ok": False, "error": f"Município '{cidade_raw}' não encontrado na base"}))
            return

        mun_cod = mun_row["codigo"]
        where = ["municipio = ?"]
        params = [mun_cod]
        if len(cnae_raw) == 7:
            where.append("cnae_principal = ?")
            params.append(cnae_raw)
        elif len(cnae_raw) >= 4:
            where.append("cnae_principal LIKE ?")
            params.append(f"{cnae_raw}%")
        if mei_only:
            where.append("optante_mei = 'S'")

        sql = f"""
            SELECT cnpj, nome_fantasia, razao_social, porte,
                   cnae_principal, endereco, bairro, cep,
                   telefone, telefone2, email, optante_mei
            FROM estabelecimentos
            WHERE {' AND '.join(where)}
            ORDER BY contact_score DESC
            LIMIT ?
        """
        params.append(limit)
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        print(json.dumps({
            "ok": True,
            "municipio": mun_row["nome"],
            "cnae": cnae_raw,
            "meiOnly": mei_only,
            "count": len(rows),
            "rows": rows,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
