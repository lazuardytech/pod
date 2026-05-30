# Edit Tool Guidelines

## Error 1: Text Found X Times (Not Unique)

**Pesan:** `Found X occurrences of the text. The text must be unique.`

**Penyebab:** `oldText` cocok di >1 tempat. Tool nggak tau mana yang harus diganti.

**Solusi:** Include baris sekitar biar match-nya unik.

### ❌ Salah — string pendek apal di banyak tempat
```json
{
  "oldText": "return result",
  "newText": "return processedResult"
}
```

### ✅ Benar — include konteks sekeliling
```json
{
  "oldText": "if (isValid) {\n    return result;\n  }",
  "newText": "if (isValid) {\n    return processedResult;\n  }"
}
```

### ✅ Alternatif — anchor ke identifier unik
```json
{
  "oldText": "private transformData() {\n    return result;",
  "newText": "private transformData() {\n    return processedResult;"
}
```

## Error 2: Text Not Found

**Pesan:** `Could not find edits[N] in <file>. The oldText must match exactly including all whitespace and newlines.`

**Penyebab:** `oldText` nggak cocok exact dengan isi file aktual. Penyebab umum:
1. **Whitespace beda** — tab vs spasi, trailing spaces, indent level beda
2. **Newline beda** — kebabisan/g kebanyakan `\n` di awal/akhir
3. **Hallucinated code** — model nebak isi file, tapi aslinya beda
4. **Stale state** — file udah di-edit sebelumnya tapi model pake `oldText` lama

### ❌ Salah — whitespace/newline nggak exact
```json
{
  "oldText": "  handleSubmit(data)\n    return data;",
  "newText": "  handleSubmit(data)\n    return validatedData;"
}
```
(Mungkin indent aslinya 4 spasi, atau ada `{}` yang ilang)

### ✅ Benar — exact copy dari file
```json
{
  "oldText": "  async handleSubmit(data: FormData) {\n    return data;\n  }",
  "newText": "  async handleSubmit(data: FormData) {\n    return validatedData;\n  }"
}
```

## Best Practices

1. **Baca dulu sebelum edit** — panggil `read <file>` untuk dapet exact text, jangan nebak
2. **Include 2-3 baris konteks** — baris sebelum + sesudah target biar unik
3. **Perhatikan whitespace** — tab, spasi, trailing spaces, indent — semua harus exact
4. **Perhatikan newlines** — jangan tambah/kurang `\n` di awal/akhir `oldText`
5. **Jangan edit file yang baru di-edit** — kalau ada edit sebelumnya, baca ulang file dulu
6. **Kalau error terus** — baca file dulu, baru coba edit lagi dengan `oldText` persis dari file
7. **Package.json, config files, dan file struktur repetitif** — yang paling sering kena kedua error ini
