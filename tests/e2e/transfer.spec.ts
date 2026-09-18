import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createAccount, origin } from '../helpers';

test('mobile envia por WebRTC; desktop grava em disco; SHA-256 e histórico conferem', async ({ browser }) => {
  const senderAccount = await createAccount('e2e-sender'), receiverAccount = await createAccount('e2e-receiver');
  const senderContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const receiverContext = await browser.newContext({ viewport: { width: 1505, height: 1045 } });
  for (const [context, account] of [[senderContext, senderAccount], [receiverContext, receiverAccount]] as const) {
    const [name, value] = account.cookie.split('=');
    await context.addCookies([{ name: name!, value: value!, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  }
  // Automate only the native save dialog. The writable below is Chromium's real
  // disk-backed OPFS implementation, not an in-memory Blob/array substitute.
  await receiverContext.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => {
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle('ponte-e2e.bin', { create: true });
    } });
  });
  const sender = await senderContext.newPage(), receiver = await receiverContext.newPage();
  const errors: string[] = [];
  for (const page of [sender, receiver]) page.on('pageerror', e => errors.push(e.message));
  if (process.env.RTC_DIAGNOSTICS) for (const page of [sender, receiver]) {
    page.on('console', message => { if (message.text().startsWith('[rtc]')) console.log(message.text()); });
    await page.addInitScript(() => {
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(Original, { construct(Target, args) {
        const pc = new Target(...args);
        pc.addEventListener('icecandidate', e => console.log('[rtc] candidate', e.candidate ? 'present' : 'end'));
        pc.addEventListener('iceconnectionstatechange', () => console.log('[rtc] ice', pc.iceConnectionState));
        pc.addEventListener('signalingstatechange', () => console.log('[rtc] signaling', pc.signalingState));
        pc.addEventListener('datachannel', () => console.log('[rtc] channel received'));
        return pc;
      } });
    });
  }
  try {
    await Promise.all([sender.goto(origin), receiver.goto(origin)]);
    await expect(receiver.getByRole('button', { name: 'Gerar código' })).toBeEnabled();
    await receiver.getByRole('button', { name: 'Gerar código' }).click();
    const pairing = receiver.getByLabel('Código para pareamento');
    await expect(pairing).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await receiver.screenshot({ path: process.env.QA_SCREENSHOT_DIR ? `${process.env.QA_SCREENSHOT_DIR}/desktop.png` : 'test-results/desktop.png', fullPage: true });
    await sender.getByRole('textbox', { name: 'Código do dispositivo' }).fill((await pairing.textContent())!);
    await sender.getByRole('button', { name: 'Conectar', exact: true }).click();
    await receiver.getByRole('button', { name: 'Permitir conexão' }).click();
    await expect(sender.getByText('Dispositivos conectados')).toBeVisible({ timeout: 45000 });
    const source = Buffer.alloc(8 * 1024 * 1024 + 17);
    for (let i = 0; i < source.length; i++) source[i] = i % 251;
    await sender.getByLabel('Arquivo para enviar').setInputFiles({ name: 'viagem.bin', mimeType: 'application/octet-stream', buffer: source });
    await sender.screenshot({ path: process.env.QA_SCREENSHOT_DIR ? `${process.env.QA_SCREENSHOT_DIR}/mobile.png` : 'test-results/mobile.png', fullPage: true });
    expect(await sender.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await sender.getByRole('button', { name: 'Enviar arquivo', exact: true }).click();
    await receiver.getByRole('button', { name: 'Escolher destino e receber' }).click();
    await expect(sender.getByText('Arquivo salvo no dispositivo de destino.')).toBeVisible({ timeout: 60000 });
    await expect(receiver.getByText('Arquivo salvo no dispositivo de destino.')).toBeVisible();
    const saved = await receiver.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('ponte-e2e.bin');
      const file = await handle.getFile();
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return { size: file.size, hash: Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('') };
    });
    expect(saved.size).toBe(source.length);
    expect(saved.hash).toBe(createHash('sha256').update(source).digest('hex'));
    await expect(receiver.locator('tbody')).toContainText('Concluído');
    await expect(sender.getByRole('progressbar')).toHaveAttribute('value', '100');
    expect(errors).toEqual([]);
    // Successful connections can carry a second (empty) file without stale state.
    await sender.getByLabel('Arquivo para enviar').setInputFiles({ name: 'vazio.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) });
    await sender.getByRole('button', { name: 'Enviar arquivo', exact: true }).click();
    await receiver.getByRole('button', { name: 'Escolher destino e receber' }).click();
    await expect(sender.getByText('Arquivo salvo no dispositivo de destino.')).toBeVisible();
    await expect(receiver.locator('tbody')).toContainText('vazio.bin');
  } finally { await senderContext.close(); await receiverContext.close(); }
});

test('cadastro e login se adaptam ao celular e mostram validação', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Crie sua conta' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill('mobile@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  expect(await page.getByLabel('Senha', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Já tenho conta' }).click();
  await expect(page.getByRole('heading', { name: 'Bem-vindo ao Ponte' })).toBeVisible();
});
