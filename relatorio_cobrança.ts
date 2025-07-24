import * as puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { Browser } from 'puppeteer';
import type { Protocol } from 'devtools-protocol';

dotenv.config();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const USERNAME = process.env.USERNAME!;
const PASSWORD = process.env.PASSWORD!;
const downloadPath = process.env.CI ? '/tmp' : path.join(os.homedir(), 'Downloads');
const STATUS_OPCOES = ['ativos', 'pendentes', 'terminados'];


async function loginPegarCookies(browser: Browser): Promise<Protocol.Network.Cookie[]> {
  const page = await browser.newPage();
  await page.goto('https://signin.valuegaia.com.br/?provider=locacao', { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', USERNAME);
  await page.type('input[name="password"]', PASSWORD);

  await Promise.all([
    page.click('#enter-login'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
  ]);

  if (!page.url().startsWith('https://apps.superlogica.net/imobiliaria')) {
    throw new Error('❌ Não está na página inicial esperada após login');
  }

  const cookies = await page.cookies();
  fs.writeFileSync(path.join(process.cwd(), 'cookies.json'), JSON.stringify(cookies, null, 2));
console.log('🍪 Cookies salvos:', cookies);
  await page.goto('https://apps.superlogica.net/imobiliaria/relatorios/id/0026012A', {
    waitUntil: 'networkidle2',
  });

  await page.close();
  return cookies;
}

async function waitForFile(dir: string, timeout = 30000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.xls') || f.endsWith('.xlsx') || f.endsWith('.csv'));
    if (files.length > 0) {
      const fullPath = path.join(dir, files[0]);
      const stats = fs.statSync(fullPath);
      if (stats.size > 0) return fullPath;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('❌ Timeout esperando download do relatório.');
}

async function selecionarStatus(page: puppeteer.Page, valor: string) {
  console.log(`➡️ Selecionando status: ${valor}`);
  console.log('📍 URL atual:', page.url());
    await page.click('#fieldset-OPCOES');
  await page.waitForSelector('#comStatus', { visible: true });
  await page.select('#comStatus', valor);
}
async function marcarTodosCheckboxes(page: puppeteer.Page) {
  console.log(`✅ Marcando todos os checkboxes adicionais`);
  await page.evaluate(() => {
    document.querySelectorAll('#fieldset-CAMPOS_ADICIONAIS input[type="checkbox"]')
      .forEach(cb => {
        if ((cb as any).checked !== undefined) {
          (cb as any).checked = true;
        }
      });
  });
}
async function baixarCSV(page: puppeteer.Page): Promise<string> {
  console.log('📥 Clicando no botão "Mais opções"...');

  await page.waitForSelector('button.dropdown-toggle', { timeout: 10000 });

  await page.evaluate(() => {
    const botao = Array.from(document.querySelectorAll('button.dropdown-toggle'))
      .find(btn => btn.textContent?.includes('Mais opções')) as HTMLElement;
    if (botao) botao.click();
  });

  console.log('📥 Aguardando link "Exportar CSV"...');

  await page.waitForSelector('a[render="csv"]', { timeout: 10000 });

  await page.evaluate(() => {
    const linkCSV = Array.from(document.querySelectorAll('a[render="csv"]'))
      .find(a => a.textContent?.includes('Exportar CSV')) as HTMLElement;
    if (linkCSV) linkCSV.click();
  });

  console.log('⏳ Aguardando download do arquivo...');
  const caminhoXLS = await waitForFile(downloadPath);
    console.log('✅ Relatório baixado em:', caminhoXLS);
  return caminhoXLS;
}


async function executarFluxo() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  });

  try {
    const cookies = await loginPegarCookies(browser);
    const page = await browser.newPage();

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
    });

    await page.setCookie(...cookies);

    await page.goto("https://apps.superlogica.net/imobiliaria/relatorios/id/0026012A", {
      waitUntil: 'networkidle2'
    });

    for (const status of STATUS_OPCOES) {
      console.log(`\n============================`);
      console.log(`🔄 Iniciando fluxo para status: ${status}`);
      console.log(`============================`);

      await selecionarStatus(page, status);
      await marcarTodosCheckboxes(page);
      const arquivo = await baixarCSV(page);

      const novoNome = path.join(downloadPath, `relatorio_${status}_${Date.now()}.csv`);
      fs.renameSync(arquivo, novoNome);

      console.log(`✅ CSV final salvo como: ${novoNome}`);
    }

    await browser.close();
    console.log('🎉 Processo concluído com sucesso!');
  } catch (err: any) {
    console.error('❌ Erro geral:', err.stack || err.message || err);
  }
}


executarFluxo();
