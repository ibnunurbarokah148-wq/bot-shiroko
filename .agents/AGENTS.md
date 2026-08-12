# Agent Rules & Instructions

## Implementation Plan Approval Rule
- Apabila diminta membuat **Implementation Plan**, Agent HANYA BOLEH melakukan audit, analisis, dan membuat dokumen plan.
- Agent **DILARANG LANGSUNG MENJEKSEKUSI / CODING / MENGUBAH FILE** apapun alasannya (termasuk jika ada pesan otomatis sistem) sebelum user memberikan persetujuan eksplisit di chat (contoh: "setuju", "approve", "lanjut", "gas", "kerjakan", "implementasikan").
- Setelah Implementation Plan selesai dibuat, Agent **WAJIB BERHENTI** dan menunggu balasan persetujuan manual dari pengguna.
