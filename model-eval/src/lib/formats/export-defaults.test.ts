import { expect, test } from 'bun:test';

const dialog = await Bun.file('../bom_engine_plugin/bom_engine/ui/export_dialog.html').text();
const uiDialog = await Bun.file('../bom_engine_plugin/bom_engine/ui_dialog.rb').text();

test('SketchUp export UI defaults to readable canonical v3 JSON', () => {
  expect(dialog).toContain('<option value="canonical_v3" selected>');
  expect(dialog).toContain('<input type="checkbox" id="prettyPrint" checked>');
  expect(dialog).toContain('<input type="checkbox" id="compressOutput">');
  expect(dialog).toContain('window.onload = function()');
  expect(dialog).toContain("selectFormat('canonical_v3')");
  expect(uiDialog).toContain('File.join(Dir.home, "bom_export_canonical.json")');
  expect(uiDialog).toMatch(/#\{File\.basename\(model\.path, File\.extname\(model\.path\)\)\}_canonical\.json/);
});
