const crypto = require("crypto");
const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const SGP_URL = process.env.SGP_URL || "https://sgfibra.sgp.tsmx.app";
const SGP_APP = process.env.SGP_APP || "";
const SGP_TOKEN = process.env.SGP_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 2);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const CONTRACT_ENABLED = String(process.env.CONTRACT_ENABLED || "false") === "true";
const MAX_DOCUMENT_SIZE = Number(process.env.MAX_DOCUMENT_SIZE || 4 * 1024 * 1024);
const ATTACH_DOCUMENTS = String(process.env.ATTACH_DOCUMENTS || "true") === "true";
const REQUIRE_DOCUMENT_ATTACH = String(process.env.REQUIRE_DOCUMENT_ATTACH || "false") === "true";
const SGP_ATTACH_PATH = process.env.SGP_ATTACH_PATH || "/api/crm/cliente/{id}/anexos";
const SGP_ATTACH_FIELD = process.env.SGP_ATTACH_FIELD || "files";

const sessions = new Map();
const rates = new Map();

const contractConfig = {
  popId: Number(process.env.CONTRACT_POP_ID || 0),
  portadorId: Number(process.env.CONTRACT_PORTADOR_ID || 0),
  formaCobrancaCodigo: Number(process.env.CONTRACT_FORMA_COBRANCA_CODIGO || 6),
  vencimentoDia: Number(process.env.CONTRACT_VENCIMENTO_DIA || 10),
  modoAquisicao: Number(process.env.CONTRACT_MODOAQUISICAO || 2),
  osInstalacao: String(process.env.CONTRACT_OS_INSTALACAO || "true") === "true",
  plans: parsePlans(process.env.PLANS_JSON || "{}")
};

function parsePlans(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clean(value, max = 180) {
  return String(value || "").replace(/<[^>]*>/g, "").trim().slice(0, max);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function validCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t += 1) {
    let sum = 0;
    for (let i = 0; i < t; i += 1) sum += Number(cpf[i]) * ((t + 1) - i);
    const digit = ((10 * sum) % 11) % 10;
    if (Number(cpf[t]) !== digit) return false;
  }
  return true;
}

function parseBirthDate(value) {
  const text = String(value || "").trim();
  let day;
  let month;
  let year;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (br) {
    day = Number(br[1]);
    month = Number(br[2]);
    year = Number(br[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function validBirthDate(value) {
  const date = parseBirthDate(value);
  if (!date) return false;
  const now = new Date();
  const age = now.getUTCFullYear() - date.getUTCFullYear();
  return age >= 16 && age <= 120;
}

function formatBirthDate(value) {
  const date = parseBirthDate(value);
  if (!date) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

function safeFilename(value, fallback) {
  const cleaned = String(value || "").replace(/[^\w.\-]+/g, "_").slice(0, 80);
  return cleaned || fallback;
}

function normalizeUpload(file, label) {
  if (!file || typeof file !== "object") throw new Error(`Envie a foto ${label} do documento.`);
  const filename = safeFilename(file.name, `documento-${label}.jpg`);
  const mimetype = clean(file.type, 80);
  const base64 = String(file.base64 || "").replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowed.has(mimetype)) throw new Error("Envie documento em JPG, PNG, WEBP ou PDF.");
  if (!buffer.length || buffer.length > MAX_DOCUMENT_SIZE) throw new Error("Cada documento deve ter ate 4 MB.");
  if (!validDocumentBytes(buffer, mimetype)) throw new Error("O arquivo do documento nao parece valido.");
  return { label, filename, mimetype, buffer };
}

function validDocumentBytes(buffer, mimetype) {
  if (mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimetype === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((item) => {
    const [key, ...rest] = item.trim().split("=");
    return [key, decodeURIComponent(rest.join("=") || "")];
  }).filter(([key]) => key));
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function makeSession(req, res) {
  const sid = crypto.randomBytes(24).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  const host = String(req.headers.host || "");
  const secure = !/^localhost(:|$)|^127\.0\.0\.1(:|$)/.test(host);
  sessions.set(sid, { csrf, createdAt: Date.now() });
  res.setHeader("Set-Cookie", `sg_cadastro=${sid}.${sign(sid)}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Max-Age=7200`);
  return { sid, csrf };
}

function getSession(req) {
  const cookie = parseCookies(req.headers.cookie || "").sg_cadastro || "";
  const [sid, signature] = cookie.split(".");
  if (!sid || !signature || signature !== sign(sid)) return null;
  const session = sessions.get(sid);
  if (!session || Date.now() - session.createdAt > 7200000) return null;
  return { sid, ...session };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' https://viacep.com.br; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    "Cache-Control": "no-store",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-Robots-Tag": "noindex, nofollow",
    ...headers
  });
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), { "Content-Type": "application/json; charset=utf-8" });
}

function htmlPage(csrf) {
  const planOptions = Object.entries(contractConfig.plans).map(([key, plan]) => (
    `<label class="plan-option"><input type="radio" name="plan" value="${escapeHtml(key)}"><span>${escapeHtml(plan.name || key)}</span></label>`
  )).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Cadastro SG Fibra</title>
  <style>
    :root{--navy:#06172f;--blue:#006cff;--gold:#ffb31a;--soft:#f4f8fc;--line:#d9e4f2;--muted:#607086}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(140deg,#06172f,#0b2447 48%,#f4f8fc 48%);color:#102033;font-family:Arial,Helvetica,sans-serif;line-height:1.45}
    main{min-height:100vh;padding:30px 5%;display:grid;place-items:center}.wrap{width:min(100%,980px);background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 24px 60px rgba(7,27,54,.22);overflow:hidden}
    header{background:linear-gradient(120deg,var(--navy),#0b3b78);color:#fff;padding:34px}header span{color:var(--gold);font-weight:900;text-transform:uppercase;font-size:12px;letter-spacing:1.4px}h1{font-size:clamp(30px,5vw,52px);line-height:1.05;margin:10px 0}header p{color:#d7e6f8;max-width:720px;margin:0}
    form{display:grid;gap:18px;padding:28px}.grid{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}label{display:grid;gap:7px;color:#263f5c;font-weight:800;font-size:14px}input,select,textarea{border:1px solid var(--line);border-radius:8px;font:inherit;min-height:46px;padding:12px;background:#f8fbff;color:#102033}textarea{min-height:86px;resize:vertical}.full{grid-column:1/-1}
    .plans{background:#f8fbff;border:1px solid var(--line);border-radius:8px;padding:16px}.plan-list{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}.plan-option{display:flex;align-items:center;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 12px}
    .documents{background:#fff8e8;border:1px solid #ffd98a;border-radius:8px;padding:16px}.documents strong{display:block;color:#5f3a00;margin-bottom:6px}.documents p{color:#6f5430;margin:0 0 14px}.documents-grid{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}.document-field{background:#fff;border:1px solid #f3c86a;border-radius:8px;padding:12px}.document-field small{color:#6f5430;font-weight:700}.camera-actions{display:flex;gap:8px;flex-wrap:wrap}.camera-button,.file-button{background:#06172f;font-size:14px;min-height:42px;padding:10px 12px}.file-button{background:#fff;color:#06172f;border:1px solid #d8b35a}.doc-preview{border:1px dashed #d8b35a;border-radius:8px;color:#6f5430;font-size:13px;font-weight:800;margin-top:8px;min-height:42px;padding:10px;background:#fffdf7}
    .camera-modal{position:fixed;inset:0;background:rgba(3,12,26,.94);display:none;z-index:20;align-items:center;justify-content:center;padding:18px}.camera-modal.is-open{display:flex}.camera-panel{width:min(100%,760px);color:#fff}.camera-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.camera-top strong{font-size:20px}.camera-close{background:rgba(255,255,255,.12);min-height:40px;padding:8px 12px}.camera-stage{position:relative;background:#000;border:1px solid rgba(255,255,255,.18);border-radius:12px;overflow:hidden;aspect-ratio:4/3}.camera-stage video{width:100%;height:100%;object-fit:cover;display:block}.document-guide{position:absolute;left:50%;top:50%;width:82%;aspect-ratio:1.58/1;transform:translate(-50%,-50%);border:3px solid var(--gold);border-radius:14px;box-shadow:0 0 0 999px rgba(0,0,0,.34),0 0 34px rgba(255,179,26,.55)}.document-guide:before,.document-guide:after{content:"";position:absolute;width:26px;height:26px;border-color:#fff}.document-guide:before{left:12px;top:12px;border-left:3px solid;border-top:3px solid}.document-guide:after{right:12px;bottom:12px;border-right:3px solid;border-bottom:3px solid}.camera-help{display:grid;gap:6px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:10px;color:#f8fbff;margin-top:12px;padding:12px}.camera-help span{color:#ffd77b;font-weight:900}.camera-bottom{display:flex;gap:10px;margin-top:12px}.capture-button{flex:1;background:var(--gold);color:#06172f}.camera-fallback{background:transparent;border:1px solid rgba(255,255,255,.4)}
    .consent{display:flex;align-items:flex-start;gap:10px;font-weight:700;color:#39536f}.consent input{min-height:auto;margin-top:4px}.hidden{display:none}
    button{background:var(--blue);border:0;border-radius:8px;color:#fff;cursor:pointer;font-size:16px;font-weight:900;min-height:52px;padding:14px 18px}button:disabled{opacity:.65;cursor:wait}.result{border-radius:8px;display:none;font-weight:800;padding:14px}.result.ok{background:#dcfce7;color:#166534;display:block}.result.error{background:#fee2e2;color:#991b1b;display:block}.result-card{display:grid;gap:8px}.result-card strong{font-size:20px}.result-card span{font-size:15px}.protocol{display:inline-block;background:#fff;border:1px solid #86efac;border-radius:8px;color:#064e3b;font-size:18px;margin-top:4px;padding:8px 10px}
    @media(max-width:720px){body{background:#f4f8fc}.grid,.documents-grid{grid-template-columns:1fr}header,form{padding:24px}}
  </style>
</head>
<body>
<main>
  <section class="wrap">
    <header>
      <span>SG Fibra</span>
      <h1>Cadastro para instalação</h1>
      <p>Preencha seus dados para a equipe consultar a disponibilidade, criar seu cadastro e continuar o atendimento.</p>
    </header>
    <form id="cadastro-form">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <input class="hidden" name="website" tabindex="-1" autocomplete="off">
      <div class="grid">
        <label>Nome completo<input name="nome" autocomplete="name" required></label>
        <label>CPF<input name="cpfcnpj" inputmode="numeric" autocomplete="off" required></label>
        <label>RG<input name="rg" autocomplete="off" required></label>
        <label>Data de nascimento<input name="datanasc" inputmode="numeric" autocomplete="bday" placeholder="DD/MM/AAAA" maxlength="10" required></label>
        <label>Celular/WhatsApp<input name="celular" type="tel" autocomplete="tel" required></label>
        <label class="full">E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>CEP<input name="cep" inputmode="numeric" autocomplete="postal-code" required></label>
        <label>Numero<input name="numero" required></label>
        <label class="full">Rua<input name="logradouro" required></label>
        <label>Bairro<input name="bairro" required></label>
        <label>Cidade<input name="cidade" required></label>
        <label>UF<input name="uf" maxlength="2" required></label>
        <label>Complemento<input name="complemento"></label>
        <label class="full">Ponto de referencia<textarea name="pontoreferencia"></textarea></label>
      </div>
      <div class="documents">
        <strong>Documento com foto</strong>
        <p>Envie uma foto da frente e outra do verso do documento para conferência de identidade.</p>
        <div class="documents-grid">
          <div class="document-field">
            <label>Frente do documento<input name="documento_frente" type="file" accept="image/*,application/pdf" capture="environment" required></label>
            <small>Encaixe a frente do documento na moldura.</small>
            <div class="camera-actions">
              <button class="camera-button" type="button" data-capture-target="documento_frente" data-capture-label="frente do documento">Abrir câmera</button>
              <button class="file-button" type="button" data-file-target="documento_frente">Escolher arquivo</button>
            </div>
            <div class="doc-preview" data-preview="documento_frente">Nenhuma foto selecionada.</div>
          </div>
          <div class="document-field">
            <label>Verso do documento<input name="documento_verso" type="file" accept="image/*,application/pdf" capture="environment" required></label>
            <small>Encaixe o verso do documento na moldura.</small>
            <div class="camera-actions">
              <button class="camera-button" type="button" data-capture-target="documento_verso" data-capture-label="verso do documento">Abrir câmera</button>
              <button class="file-button" type="button" data-file-target="documento_verso">Escolher arquivo</button>
            </div>
            <div class="doc-preview" data-preview="documento_verso">Nenhuma foto selecionada.</div>
          </div>
        </div>
      </div>
      ${planOptions ? `<div class="plans"><strong>Plano de interesse</strong><div class="plan-list">${planOptions}</div></div>` : ""}
      <label class="consent"><input type="checkbox" name="consent" value="1" required> Autorizo a SG Fibra a usar estes dados para cadastro, atendimento e consulta de disponibilidade.</label>
      <button type="submit">Enviar cadastro</button>
      <div id="result" class="result"></div>
    </form>
  </section>
</main>
<div class="camera-modal" id="camera-modal" aria-hidden="true">
  <div class="camera-panel">
    <div class="camera-top">
      <strong id="camera-title">Encaixe o documento</strong>
      <button class="camera-close" type="button" id="camera-close">Fechar</button>
    </div>
    <div class="camera-stage">
      <video id="camera-video" playsinline autoplay muted></video>
      <div class="document-guide" aria-hidden="true"></div>
    </div>
    <div class="camera-help">
      <span>Dica para ficar nítido</span>
      Deixe o documento inteiro dentro da moldura, em local claro, sem reflexo e com as letras legíveis.
    </div>
    <div class="camera-bottom">
      <button class="capture-button" type="button" id="camera-capture">Usar esta foto</button>
      <button class="camera-fallback" type="button" id="camera-file">Escolher arquivo</button>
    </div>
  </div>
</div>
<script>
  const form = document.querySelector("#cadastro-form");
  const result = document.querySelector("#result");
  const digits = (value) => value.replace(/\\D+/g, "");
  form.datanasc.addEventListener("input", () => {
    const value = digits(form.datanasc.value).slice(0, 8);
    const parts = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 8)].filter(Boolean);
    form.datanasc.value = parts.join("/");
  });
  const cameraModal = document.querySelector("#camera-modal");
  const cameraVideo = document.querySelector("#camera-video");
  const cameraTitle = document.querySelector("#camera-title");
  const cameraClose = document.querySelector("#camera-close");
  const cameraCapture = document.querySelector("#camera-capture");
  const cameraFile = document.querySelector("#camera-file");
  let cameraStream = null;
  let activeFileInput = null;

  function updatePreview(input) {
    const preview = document.querySelector('[data-preview="' + input.name + '"]');
    if (!preview) return;
    const file = input.files && input.files[0];
    preview.textContent = file ? "Arquivo pronto: " + file.name : "Nenhuma foto selecionada.";
  }

  function setCapturedFile(input, blob) {
    const file = new File([blob], input.name + "-" + Date.now() + ".jpg", { type: "image/jpeg" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    updatePreview(input);
  }

  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraModal.classList.remove("is-open");
    cameraModal.setAttribute("aria-hidden", "true");
  }

  async function openCamera(input, label) {
    activeFileInput = input;
    cameraTitle.textContent = "Encaixe a " + label;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      input.click();
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      cameraVideo.srcObject = cameraStream;
      cameraModal.classList.add("is-open");
      cameraModal.setAttribute("aria-hidden", "false");
    } catch {
      input.click();
    }
  }

  document.querySelectorAll("[data-capture-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = form.elements[button.dataset.captureTarget];
      openCamera(input, button.dataset.captureLabel || "foto do documento");
    });
  });

  document.querySelectorAll("[data-file-target]").forEach((button) => {
    button.addEventListener("click", () => form.elements[button.dataset.fileTarget].click());
  });

  [form.documento_frente, form.documento_verso].forEach((input) => {
    input.addEventListener("change", () => updatePreview(input));
  });

  cameraClose.addEventListener("click", stopCamera);
  cameraFile.addEventListener("click", () => {
    if (activeFileInput) activeFileInput.click();
    stopCamera();
  });
  cameraCapture.addEventListener("click", () => {
    if (!activeFileInput || !cameraVideo.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    canvas.getContext("2d").drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) setCapturedFile(activeFileInput, blob);
      stopCamera();
    }, "image/jpeg", 0.9);
  });

  const fileToPayload = (file) => new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Envie as fotos do documento."));
    if (file.size > ${MAX_DOCUMENT_SIZE}) return reject(new Error("Cada documento deve ter ate 4 MB."));
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      size: file.size,
      base64: String(reader.result).split(",")[1] || ""
    });
    reader.onerror = () => reject(new Error("Nao foi possivel ler o documento."));
    reader.readAsDataURL(file);
  });
  form.cep.addEventListener("blur", async () => {
    const cep = digits(form.cep.value);
    if (cep.length !== 8) return;
    try {
      const response = await fetch("https://viacep.com.br/ws/" + cep + "/json/");
      const data = await response.json();
      if (data.erro) return;
      form.logradouro.value = data.logradouro || form.logradouro.value;
      form.bairro.value = data.bairro || form.bairro.value;
      form.cidade.value = data.localidade || form.cidade.value;
      form.uf.value = data.uf || form.uf.value;
    } catch {}
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    result.className = "result";
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "Enviando...";
    try {
      const payload = Object.fromEntries(new FormData(form));
      payload.documento_frente = await fileToPayload(form.documento_frente.files[0]);
      payload.documento_verso = await fileToPayload(form.documento_verso.files[0]);
      const response = await fetch("/api/cadastro", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Nao foi possivel enviar.");
      result.className = "result ok";
      result.innerHTML = "";
      const card = document.createElement("div");
      card.className = "result-card";
      const title = document.createElement("strong");
      title.textContent = data.message || "Cadastro feito com sucesso.";
      const protocol = document.createElement("span");
      protocol.className = "protocol";
      protocol.textContent = data.protocol ? "ID do cadastro: " + data.protocol : "Cadastro recebido pela SG Fibra";
      const note = document.createElement("span");
      note.textContent = "Tire um print desta tela e envie para um atendente no WhatsApp para continuar o atendimento.";
      card.append(title, protocol, note);
      result.appendChild(card);
      form.reset();
    } catch (error) {
      result.className = "result error";
      result.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Enviar cadastro";
    }
  });
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12 * 1024 * 1024) throw new Error("Arquivo muito grande.");
  }
  return raw.length ? JSON.parse(raw) : {};
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function rateAllowed(req) {
  const today = new Date().toISOString().slice(0, 10);
  const key = crypto.createHash("sha256").update(`${today}|${clientIp(req)}|${req.headers["user-agent"] || ""}`).digest("hex");
  const item = rates.get(key) || { date: today, count: 0 };
  if (item.date !== today) item.count = 0;
  if (item.count >= DAILY_LIMIT) return false;
  item.count += 1;
  rates.set(key, item);
  return true;
}

async function sgpPost(path, payload) {
  const response = await fetch(`${SGP_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`SGP recusou o cadastro (${response.status}).`);
  return data;
}

async function sgpMultipartPost(path, fields, files) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
  files.forEach((file) => {
    form.append(SGP_ATTACH_FIELD, new Blob([file.buffer], { type: file.mimetype }), file.filename);
  });
  const response = await fetch(`${SGP_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Accept": "application/json" },
    body: form,
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`SGP recusou o anexo (${response.status}).`);
  return data;
}

async function attachDocuments(clientId, documents) {
  if (!ATTACH_DOCUMENTS || !clientId) return false;
  const path = SGP_ATTACH_PATH.replace("{id}", encodeURIComponent(String(clientId)));
  await sgpMultipartPost(path, { app: SGP_APP, token: SGP_TOKEN }, documents);
  return true;
}

function ensureOrigin(req) {
  if (!PUBLIC_BASE_URL || !req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).origin === new URL(PUBLIC_BASE_URL).origin;
  } catch {
    return false;
  }
}

async function handleCadastro(req, res) {
  if (!SGP_APP || !SGP_TOKEN) return json(res, 503, { error: "Cadastro aguardando configuracao da SG Fibra." });
  if (!ensureOrigin(req)) return json(res, 403, { error: "Origem nao autorizada." });
  const session = getSession(req);
  if (!session) return json(res, 403, { error: "Sessao expirada. Atualize a pagina." });

  const data = await readBody(req);
  if (session.csrf !== String(data.csrf || "")) return json(res, 403, { error: "Sessao expirada. Atualize a pagina." });
  if (data.website) return json(res, 400, { error: "Cadastro invalido." });

  const required = ["nome", "cpfcnpj", "rg", "datanasc", "celular", "email", "cep", "logradouro", "numero", "bairro", "cidade", "uf", "consent"];
  if (required.some((field) => !data[field])) return json(res, 422, { error: "Preencha todos os campos obrigatorios." });
  const cpf = onlyDigits(data.cpfcnpj);
  if (!validCpf(cpf)) return json(res, 422, { error: "Informe um CPF valido." });
  if (!validBirthDate(data.datanasc)) return json(res, 422, { error: "Informe a data de nascimento no formato DD/MM/AAAA." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) return json(res, 422, { error: "Informe um e-mail valido." });
  if (onlyDigits(data.celular).length < 10) return json(res, 422, { error: "Informe um celular valido." });
  const documents = [
    normalizeUpload(data.documento_frente, "frente"),
    normalizeUpload(data.documento_verso, "verso")
  ];
  if (!rateAllowed(req)) return json(res, 429, { error: "Este dispositivo ja atingiu o limite de cadastros de hoje." });

  const address = {
    logradouro: clean(data.logradouro),
    numero: clean(data.numero, 10),
    complemento: clean(data.complemento, 80),
    bairro: clean(data.bairro, 100),
    cidade: clean(data.cidade, 100),
    cep: onlyDigits(data.cep),
    uf: clean(data.uf, 2).toUpperCase(),
    pais: "BR",
    pontoreferencia: clean(data.pontoreferencia)
  };

  const clientPayload = {
    app: SGP_APP,
    token: SGP_TOKEN,
    nome: clean(data.nome, 120),
    cpfcnpj: cpf,
    rg: clean(data.rg, 30),
    identidade: clean(data.rg, 30),
    email: clean(data.email, 150),
    celular: onlyDigits(data.celular),
    datanasc: formatBirthDate(data.datanasc),
    endereco: address,
    observacao: `Cadastro realizado pelo formulario publico da SG Fibra. RG: ${clean(data.rg, 30)}. Documentos enviados: frente e verso.`
  };

  try {
    const client = await sgpPost("/api/crm/cliente/F", clientPayload);
    const clientId = Number(client.id || client.cliente_id || client?.cliente?.id || 0);
    let documentsAttached = false;
    if (clientId > 0) {
      try {
        documentsAttached = await attachDocuments(clientId, documents);
      } catch (attachError) {
        console.error("[SG cadastro anexo]", attachError.message);
        if (REQUIRE_DOCUMENT_ATTACH) throw attachError;
      }
    }
    let contract = null;
    if (CONTRACT_ENABLED && clientId > 0) {
      const planKey = clean(data.plan, 60);
      const plan = contractConfig.plans[planKey];
      if (!plan?.id) throw new Error("Plano nao configurado. Cliente criado, contrato pendente.");
      contract = await sgpPost(`/api/crm/cliente/${clientId}/contratos`, {
        app: SGP_APP,
        token: SGP_TOKEN,
        pop_id: contractConfig.popId,
        plano_id: Number(plan.id),
        portador_id: contractConfig.portadorId,
        forma_cobranca_codigo: contractConfig.formaCobrancaCodigo,
        vencimento_dia: contractConfig.vencimentoDia,
        login: cpf,
        senha: "sgfibra",
        modoaquisicao: contractConfig.modoAquisicao,
        os_instalacao: contractConfig.osInstalacao,
        conteudo: "Nova instalacao solicitada pelo formulario publico.",
        endereco_cobranca: address,
        endereco_instalacao: address
      });
    }
    json(res, 200, {
      ok: true,
      message: contract
        ? "Cadastro, contrato e documentos enviados com sucesso."
        : documentsAttached
          ? "Cadastro e documentos enviados com sucesso."
          : "Cadastro feito com sucesso. A equipe SG Fibra vai continuar o atendimento.",
      protocol: String(contract?.id || contract?.contrato_id || clientId || "")
    });
  } catch (error) {
    console.error("[SG cadastro]", error.message);
    json(res, 502, { error: "Nao foi possivel concluir agora. Tente novamente ou fale com a SG Fibra." });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/") {
      const session = makeSession(req, res);
      return send(res, 200, htmlPage(session.csrf), { "Content-Type": "text/html; charset=utf-8" });
    }
    if (req.method === "POST" && url.pathname === "/api/cadastro") return handleCadastro(req, res);
    return send(res, 404, "Pagina nao encontrada.", { "Content-Type": "text/plain; charset=utf-8" });
  } catch (error) {
    console.error("[SG cadastro]", error);
    return json(res, 500, { error: "Erro interno." });
  }
});

server.listen(PORT, () => {
  console.log(`Cadastro SG Fibra rodando na porta ${PORT}`);
});
