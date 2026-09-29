import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, previousLogo, newLogo } from '../test-support/company_settings.js';

const nativeDrop = { paths: ['C:\\Temp\\logo-arrastrado.png'], position: { x: 300, y: 300 } };
const dropEvent = file => ({ dataTransfer: { files: [file] }, preventDefault() {}, stopPropagation() {} });

test('an HTML image drop selects the file and saves it only when the form is submitted', async t => {
  const { get, settings, submit } = await setup(t);
  const zone = get('settings-company-logo-dropzone');
  assert.equal(typeof zone.ondrop, 'function', 'the logo field must accept file drops');
  await zone.ondrop(dropEvent(new File(['logo nuevo'], 'logo-arrastrado.png')));
  assert.equal(get('settings-company-logo').files[0].name, 'logo-arrastrado.png');
  assert.equal(settings.get('company_logo'), previousLogo);
  await submit();
  assert.equal(settings.get('company_logo'), newLogo);
});

test('a native image drop uses its original bytes and does not trigger the hidden CSV importer', async t => {
  const { get, settings, reads, emitNative, submit } = await setup(t, { includeCsv: true });
  get('settings-company-logo').value = '';
  await emitNative('tauri://drag-enter', nativeDrop);
  assert.ok(get('settings-company-logo-dropzone').classList.contains('drag-over'));
  await emitNative('tauri://drag-drop', nativeDrop);
  const file = get('settings-company-logo').files[0];
  assert.ok(file, 'a native drop must select an image');
  assert.equal(file.name, 'logo-arrastrado.png');
  assert.equal(new TextDecoder().decode(await file.arrayBuffer()), 'logo nuevo');
  assert.deepEqual(reads, ['read_dropped_logo_file']);
  assert.equal(get('toast-container').children.length, 0, 'the hidden CSV importer must not reject the image');
  assert.ok(!get('settings-company-logo-dropzone').classList.contains('drag-over'));
  assert.equal(settings.get('company_logo'), previousLogo);
  await submit();
  assert.equal(settings.get('company_logo'), newLogo);
});

test('a native drop outside the logo field is ignored', async t => {
  const { get, reads, emitNative } = await setup(t);
  await emitNative('tauri://drag-enter', { ...nativeDrop, position: { x: 20, y: 20 } });
  assert.ok(!get('settings-company-logo-dropzone').classList.contains('drag-over'));
  await emitNative('tauri://drag-drop', { ...nativeDrop, position: { x: 20, y: 20 } });
  assert.equal(get('settings-company-logo').files[0].name, 'nuevo.png');
  assert.deepEqual(reads, []);
});

test('an unsupported native drop clears the field without replacing the saved logo', async t => {
  const { get, settings, reads, emitNative } = await setup(t);
  await emitNative('tauri://drag-drop', { ...nativeDrop, paths: ['C:\\Temp\\invalido.txt'] });
  assert.equal(get('settings-company-logo').files.length, 0);
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.deepEqual(reads, [], 'an unsupported file must not be read');
  assert.match(get('toast-container').children.at(-1)?.innerText || '', /Formato de imagen no soportado/);
});

test('an unsupported HTML drop clears the field', async t => {
  const { get, settings } = await setup(t);
  const zone = get('settings-company-logo-dropzone');
  assert.equal(typeof zone.ondrop, 'function');
  await zone.ondrop(dropEvent(new File(['invalid'], 'invalido.txt')));
  assert.equal(get('settings-company-logo').files.length, 0);
  assert.equal(settings.get('company_logo'), previousLogo);
});

test('a native logo read failure clears the field and keeps the saved logo', async t => {
  const { get, settings, emitNative } = await setup(t, { readLogo: async () => { throw new Error('file unavailable'); } });
  await emitNative('tauri://drag-drop', nativeDrop);
  assert.equal(get('settings-company-logo').files.length, 0);
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.ok(get('toast-container').children.some(toast => toast.className === 'm3-toast error'));
});

test('a slow native drop cannot replace a newer picker selection', async t => {
  let release;
  const { get, emitNative } = await setup(t, { readLogo: () => new Promise(resolve => { release = resolve; }) });
  const pendingDrop = emitNative('tauri://drag-drop', nativeDrop);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function', 'the native read must be in progress');
  const input = get('settings-company-logo');
  input.files = [new File(['logo nuevo'], 'logo-del-selector.png')];
  input.onchange({ target: input });
  release(Array.from(new TextEncoder().encode('logo anterior pendiente')));
  await pendingDrop;
  assert.equal(input.files[0].name, 'logo-del-selector.png');
});

test('a native CSV drop still reaches its importer while the logo field is hidden', async t => {
  const { get, reads, emitNative } = await setup(t, { includeCsv: true });
  get('settings-company-logo-dropzone').visible = false;
  get('csv-dropzone').visible = true;
  await emitNative('tauri://drag-drop', { ...nativeDrop, paths: ['C:\\Temp\\clientes.csv'] });
  assert.deepEqual(reads, ['read_text_file']);
  assert.match(get('csv-file-info').textContent || '', /1 filas encontradas/);
  assert.equal(get('settings-company-logo').files[0].name, 'nuevo.png');
  assert.ok(!get('toast-container').children.some(toast => toast.className === 'm3-toast error'));
});
