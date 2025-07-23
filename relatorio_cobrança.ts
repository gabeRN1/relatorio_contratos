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
  console.log(`➡️ Selecionando status: ${valor}`);
  await page.select('#comStatus', valor);
}

async function marcarTodosCheckboxes(page: puppeteer.Page) {
  console.log(`✅ Marcando todos os checkboxes adicionais`);
  await page.evaluate(() => {
    document.querySelectorAll('#fieldset-CAMPOS_ADICIONAIS input[type="checkbox"]')
      .forEach(cb => {
        if (cb instanceof HTMLInputElement) cb.checked = true;
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
    if (dtInicio) (dtInicio as HTMLInputElement).value = inicio;
    if (dtFim) (dtFim as HTMLInputElement).value = fim;
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
    const linkCSV = Array.from(document.querySelectorAll('.dropdown-menu a')).find((a: any) =>
      a.textContent?.includes('Exportar CSV')
    ) as HTMLElement;

    if (linkCSV) linkCSV.click();
  });

  console.log('⏳ Aguardando download do arquivo...');
  const filePath = await waitForFile(downloadPath, 30000);
  console.log(`📄 Arquivo CSV baixado: ${filePath}`);
  return filePath;
}

async function executarFluxo() {
  console.log('🚀 Iniciando processo com Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // ou deixe como undefined localmente
  });

  const page = await browser.newPage();

  console.log(`⚙️ Definindo comportamento de download para: ${downloadPath}`);
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
  });

  console.log('🌐 Acessando página do relatório...');
  await page.goto('https://apps.superlogica.net/imobiliaria/relatorios/id/0026012A', {
    waitUntil: 'networkidle2',
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
}

executarFluxo().catch(err => {
  console.error('❌ Erro geral:', err.stack || err.message || err);
});
