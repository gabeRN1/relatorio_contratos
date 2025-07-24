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

  await page.goto('https://apps.superlogica.net/imobiliaria/relatorios/id/0026012A', {
    waitUntil: 'networkidle2',
  });

  await page.close();
  return cookies;
}





function getDatasFiltro(): { inicio: string; fim: string } {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);

  const formatar = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  return {
    inicio: formatar(ontem),
    fim: formatar(hoje),
  };
}

async function waitForFile(dir: string, timeout = 30000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'));
    if (files.length > 0) {
      const fullPath = path.join(dir, files[0]);
      const stats = fs.statSync(fullPath);
      if (stats.size > 0) return fullPath;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('❌ Timeout esperando download do relatório.');
}

async function baixarRelatorio(): Promise<void> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  });

  try {
    console.log('🚀 Iniciando login e obtenção de cookies...');
    const cookies = await loginPegarCookies(browser);
    const page = await browser.newPage();

    console.log('⚙️ Configurando comportamento de download...');
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
    });

    console.log('🌐 Acessando página do relatório...');
    await page.setCookie(...cookies);
    await page.goto("https://apps.superlogica.net/imobiliaria/relatorios/id/0026012A", {
      waitUntil: 'networkidle2'
    });

    const { inicio, fim } = getDatasFiltro();

    console.log(`📆 Preenchendo datas: ${inicio} a ${fim}`);
    await page.waitForSelector('#p1_alt-dt_alteracao');
    await page.evaluate((inicio, fim) => {
      (document.querySelector('#p1_alt-dt_alteracao') as HTMLInputElement).value = inicio;
      (document.querySelector('#p2_alt-dt_alteracao') as HTMLInputElement).value = fim;
    }, inicio, fim);

    console.log('🔍 Aplicando filtros e carregando resultados...');
    await Promise.all([
      page.click('#btnSubmit'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    console.log('⬇️ Aguardando botão de download...');
    await page.waitForSelector('#btnExcel', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));
    await page.click('#btnExcel');

    console.log('⏳ Aguardando arquivo ser baixado...');
    const caminhoXLS = await waitForFile(downloadPath);
    console.log('✅ Relatório baixado em:', caminhoXLS);
  } catch (err: any) {
    console.error('❌ Erro ao baixar relatório:', err.message ?? err);
  } finally {
    await browser.close();
  }
}
async function selecionarStatus(page: puppeteer.Page, valor: string) {
  console.log(`➡️ Selecionando status: ${valor}`);
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

async function aplicarFiltros(page: puppeteer.Page) {
  const { inicio, fim } = getDatasFiltro();
  console.log(`📆 Aplicando filtros de data: ${inicio} a ${fim}`);

  await page.waitForSelector('input[name="COM_DTAINICIAL"]');
  await page.evaluate((inicio, fim) => {
    const dtInicio = document.querySelector('input[name="COM_DTAINICIAL"]');
    const dtFim = document.querySelector('input[name="COM_DTAFINAL"]');
    if (dtInicio) (dtInicio as any).value = inicio;
    if (dtFim) (dtFim as any).value = fim;
  }, inicio, fim);

  console.log('🔍 Enviando filtros...');
  await Promise.all([
    page.click('#btnSubmit'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
  ]);
}

async function baixarCSV(page: puppeteer.Page): Promise<string> {
  console.log('📥 Aguardando botão de exportar CSV...');
  await page.waitForSelector('.dropdown-menu a[render="csv"]', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1000));

  console.log('⬇️ Clicando no link de exportação do CSV');
  await page.evaluate(() => {
    const linkCSV = Array.from(document.querySelectorAll('.dropdown-menu a'))
      .find(a => a.textContent?.includes('Exportar CSV')) as HTMLElement;
    if (linkCSV) linkCSV.click();
  });

  console.log('⏳ Aguardando download do arquivo...');
  const filePath = await waitForFile(downloadPath, 30000);
  console.log(`📄 Arquivo CSV baixado: ${filePath}`);
  return filePath;
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

    await page.goto("https://imob.valuegaia.com.br/admin/modules/relatorios/relatoriosFiltro.aspx?id=117", {
      waitUntil: 'networkidle2'
    });

    for (const status of STATUS_OPCOES) {
      console.log(`\n============================`);
      console.log(`🔄 Iniciando fluxo para status: ${status}`);
      console.log(`============================`);

      await selecionarStatus(page, status);
      await marcarTodosCheckboxes(page);
      await aplicarFiltros(page);
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
