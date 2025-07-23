import * as puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

const downloadPath = process.env.CI ? '/tmp' : path.join(os.homedir(), 'Downloads');

const STATUS_OPCOES = ['ativos', 'pendentes', 'terminados'];

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
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv'));
    if (files.length > 0) {
      const fullPath = path.join(dir, files[0]);
      const stats = fs.statSync(fullPath);
      if (stats.size > 0) return fullPath;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('❌ Timeout esperando download do CSV.');
}

async function selecionarStatus(page: puppeteer.Page, valor: string) {
  await page.select('#comStatus', valor);
}

async function marcarTodosCheckboxes(page: puppeteer.Page) {
  await page.evaluate(() => {
    const checkboxes = document.querySelectorAll('#fieldset-CAMPOS_ADICIONAIS input[type="checkbox"]');
    checkboxes.forEach(cb => {
      const input = cb as HTMLInputElement;
      input.checked = true;
    });
  });
}

async function aplicarFiltros(page: puppeteer.Page) {
  const { inicio, fim } = getDatasFiltro();

  await page.waitForSelector('input[name="COM_DTAINICIAL"]');
  await page.evaluate((inicio, fim) => {
    (document.querySelector('input[name="COM_DTAINICIAL"]') as HTMLInputElement).value = inicio;
    (document.querySelector('input[name="COM_DTAFINAL"]') as HTMLInputElement).value = fim;
  }, inicio, fim);

  await Promise.all([
    page.click('#btnSubmit'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
  ]);
}

async function baixarCSV(page: puppeteer.Page): Promise<string> {
  await page.waitForSelector('.dropdown-menu a[render="csv"]', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1000)); // Garante que dropdown abriu

  await page.evaluate(() => {
    const linkCSV = Array.from(document.querySelectorAll('.dropdown-menu a')).find((a: any) =>
      a.textContent?.includes('Exportar CSV')
    ) as HTMLElement;

    if (linkCSV) linkCSV.click();
  });

  return await waitForFile(downloadPath, 30000);
}

async function executarFluxo() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // Se usar no ambiente com path fixo
  });

  const page = await browser.newPage();

  // Permite download
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
  });

  // Acessa diretamente a página de relatório (supondo que já está logado)
  await page.goto('https://apps.superlogica.net/imobiliaria/relatorios/id/0026012A', {
    waitUntil: 'networkidle2',
  });

  for (const status of STATUS_OPCOES) {
    console.log(`🔄 Baixando CSV para status: ${status}`);

    await selecionarStatus(page, status);
    await marcarTodosCheckboxes(page);
    await aplicarFiltros(page);
    const arquivo = await baixarCSV(page);

    const novoNome = path.join(downloadPath, `relatorio_${status}_${Date.now()}.csv`);
    fs.renameSync(arquivo, novoNome);

    console.log(`✅ CSV salvo como: ${novoNome}`);
  }

  await browser.close();
}

executarFluxo().catch(err => {
  console.error('❌ Erro geral:', err.message ?? err);
});
