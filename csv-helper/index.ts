import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import iconv from 'iconv-lite';

function limparChaves(obj: Record<string, any>): Record<string, any> {
  const novo: Record<string, any> = {};
  for (const chave in obj) {
    const novaChave = chave
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-zA-Z0-9_]/g, '_')  // troca caracteres especiais por "_"
      .replace(/_+/g, '_')             // junta múltiplos _ seguidos
      .replace(/^_+|_+$/g, '')         // remove _ no início/fim
      .toLowerCase();                 // padroniza para minúsculas
    novo[novaChave] = obj[chave];
  }
  return novo;
}

export function adicionarColunaStatus(caminhoArquivo: string, status: string) {
  const buffer = fs.readFileSync(caminhoArquivo);
  const conteudo = iconv.decode(buffer, 'latin1');

  const linhas = conteudo.split('\n').filter(Boolean);
  const cabecalho = linhas[0].split(',');

  const registros = parse(conteudo, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    delimiter: ',',
    quote: '"',
    trim: true,
    on_record: (record: Record<string, any>, context: any) => {
      const actualCols = Object.keys(record).length;
      if (actualCols !== cabecalho.length) {
        console.warn(`⚠️ Linha ${context.lines}: esperadas ${cabecalho.length}, encontradas ${actualCols}`);
      }
      return limparChaves(record); // aplica padronização aqui
    }
  });

  const registrosComStatus = registros.map((linha: any) => ({
    ...linha,
    status
  }));

  const novoCSV = stringify(registrosComStatus, {
    header: true
  });

  fs.writeFileSync(caminhoArquivo, novoCSV);
  console.log(`📝 Coluna 'status: ${status}' adicionada ao arquivo ${path.basename(caminhoArquivo)}`);
}

export function juntarCSVPorStatus(arquivos: string[], caminhoSaida: string) {
  let todosRegistros: any[] = [];

  for (const caminho of arquivos) {
    const buffer = fs.readFileSync(caminho);
    const conteudo = iconv.decode(buffer, 'latin1');

    const registros = parse(conteudo, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      delimiter: ',',
      quote: '"',
      trim: true,
      on_record: limparChaves
    });

    todosRegistros.push(...registros);
    console.log(`📥 Registros adicionados de: ${path.basename(caminho)} (${registros.length} linhas)`);
  }

  const csvFinal = stringify(todosRegistros, {
    header: true
  });

  fs.writeFileSync(caminhoSaida, csvFinal);
  console.log(`✅ CSV final gerado em: ${caminhoSaida}`);
}
