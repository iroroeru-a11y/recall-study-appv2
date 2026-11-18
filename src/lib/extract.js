import JSZip from "jszip";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
const MAX_BYTES = 25 * 1024 * 1024;
const allowed = [".docx", ".pdf", ".pptx"];
function extension(name) { return name.toLowerCase().slice(name.lastIndexOf(".")); }
function xmlText(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagName("a:t")].map(n => n.textContent).join(" ").replace(/\s+/g, " ").trim();
}
export async function extractFile(file, onProgress = () => {}) {
  const ext = extension(file.name);
  if (!allowed.includes(ext)) throw new Error("Unsupported file. Please re-save it as .docx, .pdf or .pptx. Legacy .doc and .ppt files are not supported.");
  if (file.size > MAX_BYTES) throw new Error("This file is larger than 25 MB. Please compress it or split it into smaller files.");
  onProgress("Reading file…");
  if (ext === ".docx") {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const holder = document.createElement("div"); holder.innerHTML = result.value;
    const sections = []; let current = { title: "Document", text: "" };
    for (const el of holder.children) {
      if (/^H[1-6]$/.test(el.tagName)) {
        if (current.text.trim()) sections.push(current);
        current = { title: el.textContent.trim() || "Section", text: "" };
      } else current.text += (el.textContent || "").trim() + "\n";
    }
    if (current.text.trim()) sections.push(current);
    return sections;
  }
  if (ext === ".pdf") {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const sections = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress(`Extracting PDF page ${i} of ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim();
      if (text) sections.push({ title: `Page ${i}`, text });
    }
    if (!sections.length) throw new Error("This PDF appears to be scanned or image-only. It contains no selectable text. Run OCR on it or upload a text-based PDF.");
    return sections;
  }
  const zip = await JSZip.loadAsync(file);
  const slideNames = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b) => Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));
  const noteNames = Object.keys(zip.files).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).sort();
  const sections = [];
  for (let i = 0; i < slideNames.length; i++) {
    onProgress(`Extracting slide ${i + 1} of ${slideNames.length}…`);
    const xml = await zip.files[slideNames[i]].async("string");
    const text = xmlText(xml);
    let notes = "";
    if (noteNames[i]) notes = xmlText(await zip.files[noteNames[i]].async("string"));
    if (text || notes) sections.push({ title: `Slide ${i + 1}`, text: [text, notes ? `Speaker notes: ${notes}` : ""].filter(Boolean).join("\n") });
  }
  if (!sections.length) throw new Error("No readable slide text was found in this PowerPoint file.");
  return sections;
}
