const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const SGP_URL = process.env.SGP_URL || "https://sgfibra.sgp.tsmx.app";
const SGP_APP = process.env.SGP_APP || "";
const SGP_TOKEN = process.env.SGP_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 2);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const PRECADASTRO_ATIVAR = String(process.env.PRECADASTRO_ATIVAR || "true") === "true";
const DEFAULT_MAP_LL = clean(process.env.DEFAULT_MAP_LL || "", 80);
const sessions = new Map();
const rates = new Map();
const logoPath = path.join(__dirname, "..", "imagens", "logo-transparent.png");

const internetOnlyPlans = {
  "300": { id: 1, name: "300 Mega" },
  "500": { id: 3, name: "500 Mega" },
  "700": { id: 4, name: "700 Mega" }
};

const contractConfig = {
  popId: Number(process.env.CONTRACT_POP_ID || 1),
  nasId: Number(process.env.CONTRACT_NAS_ID || 1),
  portadorId: Number(process.env.CONTRACT_PORTADOR_ID || 1),
  formacobrancaId: Number(process.env.CONTRACT_FORMACOBRANCA_ID || process.env.CONTRACT_FORMA_COBRANCA_CODIGO || 6),
  formaCobrancaCodigo: Number(process.env.CONTRACT_FORMA_COBRANCA_CODIGO || 6),
  vencimentoDia: Number(process.env.CONTRACT_VENCIMENTO_DIA || 10),
  modoAquisicao: Number(process.env.CONTRACT_MODOAQUISICAO || 1),
  osInstalacao: String(process.env.CONTRACT_OS_INSTALACAO || "true") === "true",
  plans: parsePlans(process.env.PLANS_JSON || "{}")
};

const emailConfig = {
  enabled: String(process.env.CONFIRMATION_EMAIL_ENABLED || "false") === "true",
  host: clean(process.env.SMTP_HOST || "", 180),
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true",
  user: clean(process.env.SMTP_USER || "", 180),
  pass: String(process.env.SMTP_PASS || ""),
  from: clean(process.env.SMTP_FROM || process.env.SMTP_USER || "", 220),
  replyTo: clean(process.env.SMTP_REPLY_TO || process.env.SMTP_FROM || process.env.SMTP_USER || "", 220)
};

const knownPlanIds = {
  "300": 1,
  "300-mega": 1,
  "300-mega-internet": 1,
  "500": 3,
  "500-mega": 3,
  "500-mega-internet": 3,
  "700": 4,
  "700-mega": 4,
  "700-mega-internet": 4
};

const vencimentoIdByDay = {
  5: 1,
  10: 2,
  20: 4,
  30: 6
};

function parsePlans(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isInternetOnlyPlan(key, plan) {
  const text = `${key} ${plan?.name || ""}`.toLowerCase();
  const blocked = ["tv", "globo", "globoplay", "premiere", "telecine", "sportv", "espn", "voip", "telefone"];
  return !blocked.some((term) => text.includes(term));
}

function publicPlanEntries() {
  const merged = { ...internetOnlyPlans };
  Object.entries(contractConfig.plans).forEach(([key, plan]) => {
    if (internetOnlyPlans[key]) {
      merged[key] = plan;
    } else if (!knownPlanIds[key]) {
      merged[key] = plan;
    }
  });
  const entries = Object.entries(merged).filter(([key, plan]) => isInternetOnlyPlan(key, plan));
  return entries.length ? entries : Object.entries(internetOnlyPlans);
}

function planIdFor(key) {
  const planKey = clean(key, 60);
  const plan = contractConfig.plans[planKey] || internetOnlyPlans[planKey];
  return Number(plan?.id || knownPlanIds[planKey] || 0);
}

function planLabelFor(key) {
  const planKey = clean(key, 60);
  const plan = contractConfig.plans[planKey] || internetOnlyPlans[planKey];
  return clean(plan?.name || planKey || "Plano nao informado", 100);
}

function vencimentoId(day = 0) {
  if (day > 0) return vencimentoIdByDay[day] || day;
  const explicit = Number(process.env.CONTRACT_VENCIMENTO_ID || 0);
  if (explicit > 0) return explicit;
  return vencimentoIdByDay[contractConfig.vencimentoDia] || contractConfig.vencimentoDia;
}

function vencimentoDayFor(value) {
  const day = Number(onlyDigits(value));
  return vencimentoIdByDay[day] ? day : 0;
}

function clean(value, max = 180) {
  return String(value || "").replace(/<[^>]*>/g, "").trim().slice(0, max);
}

function supportCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function parseJsonSafe(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function errorSummary(error) {
  return clean(error?.message || error, 500);
}

function isDuplicateCpfError(error) {
  return /j[aá]\s*existe.*cpf|cpf.*j[aá]\s*existe|cliente.*cpf informado/i.test(errorSummary(error));
}

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function sgpFieldError(error) {
  const errors = error?.data?.errors;
  if (!errors || typeof errors !== "object") return "";
  const first = Object.entries(errors)[0];
  if (!first) return "";
  const [field, message] = first;
  const label = {
    celular: "Celular",
    email: "E-mail",
    cpfcnpj: "CPF",
    datanasc: "Data de nascimento",
    rg: "RG",
    endereco: "Endereco"
  }[field] || clean(field, 40);
  return `${label}: ${clean(Array.isArray(message) ? message.join(" ") : message, 180)}`;
}

function normalizePhone(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return digits;
  if (digits.length === 10) return `${digits.slice(0, 2)}9${digits.slice(2)}`;
  return digits;
}

function formatPhoneBr(value) {
  const phone = normalizePhone(value);
  if (phone.length !== 11) return phone;
  return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
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

function formatBirthDateIso(value) {
  const date = parseBirthDate(value);
  if (!date) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
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

function signedCookieValue(value) {
  return `${value}.${sign(value)}`;
}

function readSignedCookie(req, name) {
  const cookie = parseCookies(req.headers.cookie || "")[name] || "";
  const [value, signature] = cookie.split(".");
  if (!value || !signature || signature !== sign(value)) return "";
  return value;
}

function makeSession(req, res) {
  const sid = crypto.randomBytes(24).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  const deviceId = readSignedCookie(req, "sg_device") || crypto.randomBytes(24).toString("hex");
  const host = String(req.headers.host || "");
  const secure = !/^localhost(:|$)|^127\.0\.0\.1(:|$)/.test(host);
  sessions.set(sid, { csrf, createdAt: Date.now() });
  res.setHeader("Set-Cookie", [
    `sg_cadastro=${signedCookieValue(sid)}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Max-Age=7200`,
    `sg_device=${signedCookieValue(deviceId)}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Max-Age=2592000`
  ]);
  return { sid, csrf };
}

function getSession(req) {
  const sid = readSignedCookie(req, "sg_cadastro");
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session || Date.now() - session.createdAt > 7200000) return null;
  return { sid, ...session };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' https://viacep.com.br; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    "Cache-Control": "no-store",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
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
  const planOptions = publicPlanEntries().map(([key, plan]) => (
    `<label class="plan-option"><input type="radio" name="plan" value="${escapeHtml(key)}" required><span>${escapeHtml(plan.name || key)}</span></label>`
  )).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <meta name="robots" content="noindex, nofollow">
  <title>&Aacute;rea de cadastro</title>
  <link rel="icon" href="/logo.png" type="image/png">
  <link rel="shortcut icon" href="/favicon.ico">
  <style>
    :root{--navy:#06172f;--blue:#006cff;--gold:#ffb31a;--soft:#f4f8fc;--line:#d9e4f2;--muted:#607086}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(140deg,#06172f,#0b2447 48%,#f4f8fc 48%);color:#102033;font-family:Arial,Helvetica,sans-serif;line-height:1.45}
    main{min-height:100vh;padding:30px 5%;display:grid;place-items:center}.wrap{width:min(100%,980px);background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 24px 60px rgba(7,27,54,.22);overflow:hidden}
    header{background:linear-gradient(120deg,var(--navy),#0b3b78);color:#fff;padding:34px}header span{color:var(--gold);font-weight:900;text-transform:uppercase;font-size:12px;letter-spacing:1.4px}h1{font-size:clamp(30px,5vw,52px);line-height:1.05;margin:10px 0}header p{color:#d7e6f8;max-width:720px;margin:0}
    form{display:grid;gap:18px;padding:28px}.grid{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}label{display:grid;gap:7px;color:#263f5c;font-weight:800;font-size:14px}input,select,textarea{border:1px solid var(--line);border-radius:8px;font:inherit;font-size:16px;min-height:46px;padding:12px;background:#f8fbff;color:#102033}textarea{min-height:86px;resize:vertical}.full{grid-column:1/-1}
    .plans{background:#f8fbff;border:1px solid var(--line);border-radius:8px;padding:16px}.plan-list{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}.plan-option{display:flex;align-items:center;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 12px}
    .success-modal{position:fixed;inset:0;background:rgba(3,12,26,.94);display:none;z-index:20;align-items:center;justify-content:center;padding:18px;overflow:auto}.success-modal.is-open{display:flex}
    .consent{display:flex;align-items:flex-start;gap:10px;font-weight:700;color:#39536f}.consent input{min-height:auto;margin-top:4px}.hidden{display:none}
    button{background:var(--blue);border:0;border-radius:8px;color:#fff;cursor:pointer;font-size:16px;font-weight:900;min-height:52px;padding:14px 18px}button:disabled{opacity:.65;cursor:wait}.result{border-radius:8px;display:none;font-weight:800;padding:14px}.result.error{background:#fee2e2;color:#991b1b;display:block}.success-card{background:#fff;border:1px solid rgba(255,255,255,.2);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.35);color:#102033;display:grid;gap:14px;justify-items:center;max-width:440px;padding:26px;text-align:center;width:min(100%,440px)}.success-card img{height:auto;max-width:190px;width:58%}.success-card strong{font-size:24px;line-height:1.15}.success-card p{color:#39536f;margin:0}.protocol{display:inline-block;background:#fff8e8;border:1px solid #ffd98a;border-radius:8px;color:#5f3a00;font-size:20px;font-weight:900;margin-top:2px;padding:10px 12px}.success-close{width:100%}
    @media(max-width:720px){body{background:#f4f8fc}.grid{grid-template-columns:1fr}main{display:block;padding:0}.wrap{border:0;border-radius:0;min-height:100vh;width:100%;box-shadow:none}header{padding:22px}form{gap:14px;padding:18px}.success-modal{align-items:flex-start;padding:12px}.success-card{margin-top:26px;padding:22px 16px}}
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
        <label>Sexo<select name="sexo" required><option value="">Selecione</option><option value="F">Feminino</option><option value="M">Masculino</option></select></label>
        <label>Estado civil<select name="estadocivil" required><option value="">Selecione</option><option value="S">Solteiro(a)</option><option value="C">Casado(a)</option><option value="D">Divorciado(a)</option><option value="V">Viuvo(a)</option></select></label>
        <label>Celular/WhatsApp<input name="celular" type="tel" autocomplete="tel" required></label>
        <label class="full">E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Vencimento<select name="vencimento" required><option value="">Selecione</option><option value="5">Dia 5</option><option value="10">Dia 10</option><option value="20">Dia 20</option><option value="30">Dia 30</option></select></label>
        <label>CEP<input name="cep" inputmode="numeric" autocomplete="postal-code" required></label>
        <label>Numero<input name="numero" required></label>
        <label class="full">Rua<input name="logradouro" required></label>
        <label>Bairro<input name="bairro" required></label>
        <label>Cidade<input name="cidade" required></label>
        <label>UF<input name="uf" maxlength="2" required></label>
        <label>Complemento<input name="complemento"></label>
        <label class="full">Ponto de referencia<textarea name="pontoreferencia"></textarea></label>
      </div>
      ${planOptions ? `<div class="plans"><strong>Plano de interesse</strong><div class="plan-list">${planOptions}</div></div>` : ""}
      <label class="consent"><input type="checkbox" name="consent" value="1" required> Autorizo a SG Fibra a usar estes dados para cadastro, atendimento e consulta de disponibilidade.</label>
      <button type="submit">Enviar cadastro</button>
      <div id="result" class="result"></div>
    </form>
  </section>
</main>
<div class="success-modal" id="success-modal" aria-hidden="true">
  <div class="success-card">
    <img src="/logo.png" alt="SG Fibra">
    <strong id="success-title">Cadastro concluido</strong>
    <span class="protocol" id="success-protocol">ID do contrato: -</span>
    <p>Tire um print desta tela e envie para um atendente no WhatsApp para continuar o atendimento.</p>
    <button class="success-close" type="button" id="success-close">Fechar</button>
  </div>
</div>
<script>
  const form = document.querySelector("#cadastro-form");
  const result = document.querySelector("#result");
  const successModal = document.querySelector("#success-modal");
  const successTitle = document.querySelector("#success-title");
  const successProtocol = document.querySelector("#success-protocol");
  const successClose = document.querySelector("#success-close");
  const digits = (value) => value.replace(/\\D+/g, "");
  form.datanasc.addEventListener("input", () => {
    const value = digits(form.datanasc.value).slice(0, 8);
    const parts = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 8)].filter(Boolean);
    form.datanasc.value = parts.join("/");
  });
  successClose.addEventListener("click", () => {
    successModal.classList.remove("is-open");
    successModal.setAttribute("aria-hidden", "true");
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
      const response = await fetch("/api/cadastro", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        const suffix = data.support ? " Código: " + data.support : "";
        throw new Error((data.error || "Nao foi possivel enviar.") + suffix);
      }
      result.className = "result";
      result.innerHTML = "";
      successTitle.textContent = data.message || "Cadastro concluido";
      successProtocol.textContent = data.protocol ? (data.protocolLabel || "ID do contrato") + ": " + data.protocol : "Cadastro recebido pela SG Fibra";
      successModal.classList.add("is-open");
      successModal.setAttribute("aria-hidden", "false");
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
    if (raw.length > 128 * 1024) throw new Error("Cadastro muito grande.");
  }
  return raw.length ? JSON.parse(raw) : {};
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function rateKey(scope, value) {
  return crypto.createHash("sha256").update(`${new Date().toISOString().slice(0, 10)}|${scope}|${value}`).digest("hex");
}

function overLimit(key) {
  const today = new Date().toISOString().slice(0, 10);
  const item = rates.get(key) || { date: today, count: 0 };
  if (item.date !== today) item.count = 0;
  return item.count >= DAILY_LIMIT;
}

function incrementLimit(key) {
  const today = new Date().toISOString().slice(0, 10);
  const item = rates.get(key) || { date: today, count: 0 };
  if (item.date !== today) item.count = 0;
  item.count += 1;
  rates.set(key, item);
}

function rateLimitKeys(req, data) {
  const deviceId = readSignedCookie(req, "sg_device") || "sem-device";
  const userAgent = clean(req.headers["user-agent"] || "sem-navegador", 220);
  const phone = normalizePhone(data.celular);
  const identifiers = [
    ["ip", clientIp(req)],
    ["dispositivo", deviceId],
    ["navegador", `${clientIp(req)}|${userAgent}`],
    ["cpf", onlyDigits(data.cpfcnpj)],
    ["telefone", phone]
  ].filter(([, value]) => value);
  return identifiers.map(([scope, value]) => rateKey(scope, value));
}

function rateAllowed(keys) {
  if (keys.some(overLimit)) return false;
  return true;
}

function registerSuccessfulCadastro(keys) {
  keys.forEach(incrementLimit);
}

async function sgpPost(path, payload) {
  const response = await fetch(`${SGP_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000)
  });
  const text = await response.text();
  const data = parseJsonSafe(text);
  if (!response.ok) {
    const detail = clean(text || JSON.stringify(data), 500);
    const error = new Error(`SGP recusou o cadastro (${response.status}). ${detail}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function latestContractIdFor(cpf) {
  try {
    const data = await sgpPost("/api/central/contratos", {
      cpfcnpj: cpf,
      senha: "sgfibra"
    });
    const contracts = Array.isArray(data?.contratos) ? data.contratos : [];
    const ids = contracts
      .map((contract) => Number(contract?.contrato || contract?.contrato_id || contract?.id || 0))
      .filter((id) => id > 0);
    return ids.length ? String(Math.max(...ids)) : "";
  } catch (error) {
    console.error("[SG contrato consulta]", errorSummary(error));
    return "";
  }
}

function confirmationEmailReady() {
  return emailConfig.enabled && emailConfig.host && emailConfig.port && emailConfig.user && emailConfig.pass && emailConfig.from;
}

let mailTransporter = null;

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  const nodemailer = require("nodemailer");
  mailTransporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: {
      user: emailConfig.user,
      pass: emailConfig.pass
    }
  });
  return mailTransporter;
}

async function sendConfirmationEmail({ to, name, contractId, planLabel, vencimentoDay }) {
  if (!confirmationEmailReady()) return;
  const safeName = clean(name, 120) || "cliente";
  const safePlan = clean(planLabel, 100) || "plano escolhido";
  const safeContract = clean(contractId, 40) || "em analise";
  const safeVencimento = clean(vencimentoDay, 2) || "informado";
  const subject = "Cadastro recebido - SG Fibra";
  const text = [
    `Ola, ${safeName}.`,
    "",
    "Recebemos seu cadastro na SG Fibra e vamos dar continuidade com a contratacao do novo ponto.",
    "",
    `ID do contrato: ${safeContract}`,
    `Plano escolhido: ${safePlan}`,
    `Vencimento escolhido: dia ${safeVencimento}`,
    "",
    "Se ainda nao enviou o print da tela de conclusao para o atendimento, envie pelo WhatsApp para facilitar a localizacao do cadastro.",
    "",
    "Atenciosamente,",
    "SG Fibra"
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;color:#102033;line-height:1.5">
      <h2 style="color:#0066ff;margin:0 0 12px">Cadastro recebido - SG Fibra</h2>
      <p>Ola, <strong>${escapeHtml(safeName)}</strong>.</p>
      <p>Recebemos seu cadastro na SG Fibra e vamos dar continuidade com a contratacao do novo ponto.</p>
      <div style="background:#f4f8ff;border:1px solid #d7e6ff;border-radius:8px;margin:18px 0;padding:14px">
        <p style="margin:0 0 8px"><strong>ID do contrato:</strong> ${escapeHtml(safeContract)}</p>
        <p style="margin:0 0 8px"><strong>Plano escolhido:</strong> ${escapeHtml(safePlan)}</p>
        <p style="margin:0"><strong>Vencimento escolhido:</strong> dia ${escapeHtml(safeVencimento)}</p>
      </div>
      <p>Se ainda nao enviou o print da tela de conclusao para o atendimento, envie pelo WhatsApp para facilitar a localizacao do cadastro.</p>
      <p>Atenciosamente,<br><strong>SG Fibra</strong></p>
    </div>
  `;

  await getMailTransporter().sendMail({
    from: emailConfig.from,
    to,
    replyTo: emailConfig.replyTo || undefined,
    subject,
    text,
    html
  });
}

async function geocodeAddress(address) {
  if (DEFAULT_MAP_LL) return DEFAULT_MAP_LL;
  const parts = [
    address.logradouro,
    address.numero,
    address.bairro,
    address.cidade,
    address.uf,
    address.cep,
    "Brasil"
  ].filter(Boolean);
  const query = parts.join(", ");
  if (!query.trim()) return "";
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "br");
    url.searchParams.set("q", query);
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "SGFibraCadastro/1.0 contato@sgfibra.com.br"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return "";
    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    const lat = Number(first?.lat);
    const lon = Number(first?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
    return `${lat.toFixed(7)},${lon.toFixed(7)}`;
  } catch {
    return "";
  }
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

  const required = ["nome", "cpfcnpj", "rg", "datanasc", "sexo", "estadocivil", "celular", "email", "vencimento", "cep", "logradouro", "numero", "bairro", "cidade", "uf", "plan", "consent"];
  if (required.some((field) => !data[field])) return json(res, 422, { error: "Preencha todos os campos obrigatorios." });
  const cpf = onlyDigits(data.cpfcnpj);
  const phone = normalizePhone(data.celular);
  if (!validCpf(cpf)) return json(res, 422, { error: "Informe um CPF valido." });
  if (!validBirthDate(data.datanasc)) return json(res, 422, { error: "Informe a data de nascimento no formato DD/MM/AAAA." });
  if (!["F", "M"].includes(String(data.sexo))) return json(res, 422, { error: "Escolha o sexo." });
  if (!["S", "C", "D", "V"].includes(String(data.estadocivil))) return json(res, 422, { error: "Escolha o estado civil." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) return json(res, 422, { error: "Informe um e-mail valido." });
  if (!/^\d{2}9\d{8}$/.test(phone)) return json(res, 422, { error: "Informe um celular valido com DDD." });
  const selectedVencimentoDay = vencimentoDayFor(data.vencimento);
  if (!selectedVencimentoDay) return json(res, 422, { error: "Escolha uma data de vencimento valida." });
  const dailyLimitKeys = rateLimitKeys(req, data);
  if (!rateAllowed(dailyLimitKeys)) return json(res, 429, { error: "Limite diario atingido. Para evitar cadastros repetidos, permitimos no maximo 2 cadastros concluidos por dia." });

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
  const selectedPlanId = planIdFor(data.plan);
  const selectedPlanLabel = planLabelFor(data.plan);
  const mapLl = await geocodeAddress(address);
  const observation = [
    "Pre-cadastro realizado pelo formulario publico da SG Fibra.",
    `Plano escolhido: ${selectedPlanLabel}${selectedPlanId ? ` (ID SGP: ${selectedPlanId})` : ""}.`,
    `Contrato automatico: PPPoE login ${cpf}, senha sgfibra, aquisicao comodato.`,
    `Vencimento escolhido: dia ${selectedVencimentoDay}.`,
    `RG: ${clean(data.rg, 30)}.`,
    `WhatsApp: ${phone}.`,
    `E-mail: ${clean(data.email, 150)}.`,
    `Endereco informado: ${address.logradouro}, ${address.numero}${address.complemento ? `, ${address.complemento}` : ""} - ${address.bairro}, ${address.cidade}/${address.uf}, CEP ${address.cep}.`,
    address.pontoreferencia ? `Referencia: ${address.pontoreferencia}.` : ""
  ].filter(Boolean).join(" ");

  const clientPayload = {
    app: SGP_APP,
    token: SGP_TOKEN,
    nome: clean(data.nome, 120),
    cpfcnpj: cpf,
    rg: clean(data.rg, 30),
    rg_emissor: "SSP",
    identidade: clean(data.rg, 30),
    email: clean(data.email, 150),
    celular: phone,
    datanasc: formatBirthDateIso(data.datanasc),
    sexo: clean(data.sexo, 1).toUpperCase(),
    estadocivil: clean(data.estadocivil, 1).toUpperCase(),
    logradouro: address.logradouro,
    numero: address.numero,
    complemento: address.complemento,
    bairro: address.bairro,
    cidade: address.cidade,
    uf: address.uf,
    cep: address.cep,
    pais: address.pais,
    pontoreferencia: address.pontoreferencia,
    map_ll: mapLl,
    vencimento_id: vencimentoId(selectedVencimentoDay),
    login: cpf,
    senha: "sgfibra",
    central_senha: "sgfibra",
    modoaquisicao: 1,
    precadastro_ativar: PRECADASTRO_ATIVAR ? 1 : 0,
    observacao: observation
  };

  if (selectedPlanId) {
    clientPayload.plano_id = selectedPlanId;
    clientPayload.planointernet_id = selectedPlanId;
  }
  if (contractConfig.popId) clientPayload.pop_id = contractConfig.popId;
  if (contractConfig.nasId) clientPayload.nas_id = contractConfig.nasId;
  if (contractConfig.portadorId) clientPayload.portador_id = contractConfig.portadorId;
  if (contractConfig.formacobrancaId) clientPayload.formacobranca_id = contractConfig.formacobrancaId;
  if (contractConfig.modoAquisicao || contractConfig.modoAquisicao === 0) clientPayload.modoaquisicao = contractConfig.modoAquisicao;
  clientPayload.os_instalacao = contractConfig.osInstalacao;

  try {
    const client = await sgpPost("/api/precadastro/F", clientPayload);
    const clientId = Number(client.id || client.precadastro_id || client.cliente_id || client?.precadastro?.id || client?.cliente?.id || 0);
    if (clientId > 0) {
      registerSuccessfulCadastro(dailyLimitKeys);
    }
    const contractId = await latestContractIdFor(cpf);
    const responsePayload = {
      ok: true,
      message: contractId
        ? "Cadastro e contrato enviados com sucesso."
        : "Cadastro feito com sucesso. A equipe SG Fibra vai continuar o atendimento.",
      protocolLabel: contractId ? "ID do contrato" : "ID do pre-cadastro",
      protocol: String(contractId || clientId || "")
    };
    json(res, 200, responsePayload);
    sendConfirmationEmail({
      to: clean(data.email, 150),
      name: clean(data.nome, 120),
      contractId: responsePayload.protocol,
      planLabel: selectedPlanLabel,
      vencimentoDay: selectedVencimentoDay
    }).catch((error) => {
      console.error("[SG email confirmacao]", errorSummary(error));
    });
  } catch (error) {
    if (isDuplicateCpfError(error)) {
      return json(res, 409, {
        error: "Este CPF ja possui cadastro na SG Fibra. Fale com um atendente para localizar ou atualizar o cadastro."
      });
    }
    const fieldError = sgpFieldError(error);
    if (fieldError) {
      return json(res, 422, { error: fieldError });
    }
    const code = supportCode();
    console.error(`[SG cadastro ${code}]`, errorSummary(error));
    json(res, 502, {
      error: "Nao foi possivel concluir agora. Envie o codigo para a SG Fibra verificar.",
      support: code
    });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.method === "GET" && (url.pathname === "/logo.png" || url.pathname === "/favicon.ico")) {
      const logo = fs.readFileSync(logoPath);
      return send(res, 200, logo, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
    }
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
