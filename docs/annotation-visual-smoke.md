# Annotation visual smoke

Browser smoke setup reached `?annotate=tier1` and verified the route renders
without initial browser console failures. Local model file selection could not
be completed through the available in-app browser upload surface: its browser
API exposes no file-input setter and the native picker did not become a
targetable dialog.

No temporary annotation labels were committed. Required visual checks remain
pending for test, house2, and presentation20: highlighted primitive range,
unrelated-geometry fade, queue/filter interaction, export/import restoration,
and presentation20 progress screenshot.
