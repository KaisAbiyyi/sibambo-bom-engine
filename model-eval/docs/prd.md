# PRD Singkat — User Experience Fitur Analisis Bangunan dari JSON 3D

## 1. Latar Belakang

User memiliki model bangunan dalam format JSON 3D. Saat ini model hanya dapat divisualisasikan. Fitur baru dibutuhkan agar user dapat melakukan analisis bangunan seperti kenyamanan termal, pencahayaan, kebutuhan AC, flow manusia, flow angin, dan OTTV tanpa harus memahami seluruh parameter teknis secara manual.

## 2. Tujuan Produk

Membantu user menganalisis performa bangunan dari model JSON 3D dengan proses yang mudah, bertahap, dan minim input teknis.

Produk harus:

* membaca data bangunan dari JSON secara otomatis;
* memberi tahu data apa yang sudah terdeteksi;
* meminta data tambahan hanya saat dibutuhkan;
* menyajikan hasil analisis dalam bentuk visual dan tabel yang mudah dipahami.

## 3. Target User

### Primary User

Mahasiswa, dosen, atau pengguna teknis ringan yang ingin mengevaluasi model bangunan tanpa harus menghitung manual seluruh parameter.

### Secondary User

Pengembang sistem yang perlu mengetahui bagaimana data tambahan dikumpulkan dari user untuk menjalankan engine analisis deterministik.

## 4. Masalah User

User sering tidak tahu:

* data apa yang perlu diinput;
* kenapa data tersebut dibutuhkan;
* istilah teknis seperti U-value, SHGC, OTTV, lux, LLF, dan CU;
* apakah model JSON sudah cukup untuk dianalisis;
* bagian mana yang harus dilengkapi terlebih dahulu.

## 5. Prinsip UX

1. **Auto-detect first**
   Sistem membaca data dari JSON terlebih dahulu sebelum meminta input user.

2. **Progressive input**
   User tidak langsung diberikan form panjang. Input tambahan muncul sesuai analisis yang dipilih.

3. **Human-friendly language**
   Gunakan istilah sederhana seperti “jenis kaca”, “fungsi ruang”, “arah hadap bangunan”, bukan istilah teknis mentah.

4. **Preset over manual input**
   User memilih preset seperti “bata + plester”, “kaca bening”, “retail”, “gudang”, lalu sistem memetakan ke nilai teknis.

5. **Explain why**
   Setiap input tambahan harus menjelaskan kenapa data itu dibutuhkan.

## 6. User Flow Utama

```text
Upload JSON
↓
Sistem membaca model
↓
Preview hasil deteksi bangunan
↓
Sistem menampilkan status kesiapan analisis
↓
User memilih jenis analisis
↓
Sistem meminta data tambahan yang relevan
↓
User menjalankan analisis
↓
Hasil muncul sebagai tabel + visual overlay
↓
User dapat export hasil
```

## 7. Fitur Utama

### 7.1 Upload dan Auto Parsing JSON

User dapat mengupload file JSON model 3D.

Sistem menampilkan hasil deteksi awal:

* jumlah ruang;
* luas ruang;
* volume ruang;
* jumlah pintu;
* jumlah jendela;
* elemen atap;
* elemen dinding;
* komponen/furnitur penting.

### 7.2 Analysis Readiness Panel

Sistem menampilkan status kesiapan tiap analisis.

Contoh:

| Analisis     | Status        | Data Kurang                |
| ------------ | ------------- | -------------------------- |
| Pencahayaan  | Belum siap    | Fungsi ruang               |
| AC           | Belum siap    | Fungsi ruang, jumlah orang |
| OTTV         | Belum siap    | Orientasi, material kaca   |
| Flow manusia | Siap sebagian | Fungsi ruang               |
| Flow angin   | Belum siap    | Arah angin dominan         |

### 7.3 Guided Input per Analisis

User hanya diminta mengisi data yang relevan dengan analisis yang sedang dipilih.

Contoh untuk pencahayaan:

* fungsi ruang;
* target pencahayaan otomatis berdasarkan fungsi;
* spesifikasi lampu atau preset lampu.

Contoh untuk AC:

* fungsi ruang;
* jumlah orang;
* jam operasional;
* set point suhu.

Contoh untuk OTTV:

* orientasi bangunan;
* jenis dinding;
* jenis kaca;
* warna/material fasad.

### 7.4 Preset Input

Sistem menyediakan pilihan siap pakai.

Contoh fungsi ruang:

* retail;
* gudang;
* kantor;
* pantry;
* koridor;
* servis.

Contoh material:

* bata + plester;
* beton;
* kaca bening;
* kaca tinted;
* atap spandek tanpa insulasi;
* atap spandek dengan insulasi.

### 7.5 Visual Result Overlay

Hasil analisis ditampilkan di atas model 3D.

Contoh:

* heatmap untuk area panas;
* titik lampu pada plafon;
* panah flow manusia;
* panah flow angin;
* label kapasitas AC per ruang;
* warna fasad untuk nilai OTTV.

### 7.6 Export Report

User dapat mengunduh hasil analisis dalam bentuk laporan singkat berisi:

* data input;
* data hasil deteksi JSON;
* hasil perhitungan;
* rekomendasi;
* visualisasi.

## 8. User Stories

| Sebagai | Saya ingin                                    | Agar                                          |
| ------- | --------------------------------------------- | --------------------------------------------- |
| User    | upload JSON model bangunan                    | sistem bisa membaca geometri bangunan         |
| User    | melihat data apa saja yang berhasil dideteksi | saya tahu model saya terbaca dengan benar     |
| User    | diberi tahu data apa yang kurang              | saya tahu apa yang harus dilengkapi           |
| User    | memilih preset, bukan memasukkan angka teknis | saya tidak perlu memahami istilah rumit       |
| User    | menjalankan analisis satu per satu            | saya tidak kewalahan                          |
| User    | melihat hasil dalam visual 3D                 | saya mudah memahami masalah bangunan          |
| User    | export laporan                                | saya bisa menyerahkan hasil ke dosen atau tim |

## 9. Requirement UX

### Must Have

* Upload JSON.
* Preview hasil deteksi model.
* Panel status kesiapan analisis.
* Form input bertahap.
* Preset fungsi ruang.
* Preset material.
* Hasil analisis dalam tabel.
* Visual overlay dasar.
* Export laporan.

### Should Have

* Auto-estimate data default.
* Tooltip penjelasan setiap input.
* Validasi input.
* Indikator confidence hasil deteksi.
* Mode edit data ruang.

### Could Have

* Drag compass untuk orientasi bangunan.
* Auto-suggest fungsi ruang.
* Compare before-after rekomendasi.
* Simpan template proyek.

## 10. Batasan Produk

Produk tidak menggantikan perhitungan profesional final.
Hasil analisis bersifat estimasi awal berbasis data JSON, preset, dan input user.

Produk tidak mengubah file JSON asli.
Semua hasil analisis disimpan sebagai data tambahan atau overlay di browser.

## 11. Success Metrics

Produk dianggap berhasil jika:

* user dapat menyelesaikan analisis dasar tanpa membaca dokumentasi teknis panjang;
* user memahami data apa yang kurang;
* user dapat menjalankan minimal satu analisis dalam waktu singkat setelah upload JSON;
* hasil analisis dapat dipahami melalui visual dan tabel;
* user dapat mengekspor laporan sebagai output tugas atau review teknis.

## 12. Out of Scope

Untuk tahap awal, fitur berikut tidak termasuk:

* simulasi CFD detail;
* simulasi energi bangunan penuh;
* validasi struktur bangunan;
* desain MEP final;
* perubahan otomatis pada model JSON asli;
* perhitungan legal compliance penuh.
