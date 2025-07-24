import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export function adicionarColunaStatus(caminhoArquivo: string, status: string) {
  const conteudo = fs.readFileSync(caminhoArquivo, 'utf8');

  const registros = parse(conteudo, {
    columns: true,
    skip_empty_lines: true
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
    const conteudo = fs.readFileSync(caminho, 'utf8');

    const registros = parse(conteudo, {
      columns: true,
      skip_empty_lines: true,
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
