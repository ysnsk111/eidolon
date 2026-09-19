import fs from 'node:fs';
import pdfParse from 'pdf-parse';
import { parseTxtString } from './txt.js';

export async function parsePdfChat(filePath, options = {}) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const textContent = pdfData.text || '';

  return parseTxtString(textContent, {
    ...options,
    pdfInfo: {
      numpages: pdfData.numpages,
      info: pdfData.info,
    },
  });
}
