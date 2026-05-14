# Sibambo BOM Engine React UI Draft 01

This folder contains React UI Draft 01 for the Sibambo BOM Engine react-1.

This PR does not modify `bom_engine_plugin/`.

This PR does not modify the Ruby SketchUp exporter.

This PR does not change the JSON schema.

The React app loads its local UI draft model copy from:

```text
react-1/public/Model_SBMBOOST_bom_visual_nonPretty-print.json
```

## Run Locally

```bash
cd react-1
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally:

```text
http://localhost:5173
```

The default page opens **Anatomy Story** so the scroll-based architectural presentation is visible immediately.

**Model Viewer** is still available from the UI tab for the dark dashboard viewer.
