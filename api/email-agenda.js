// api/email-agenda.js — recebe o e-mail de agendamento (vindo da macro do Outlook)
// e grava compromissos em medvisit/dados/agendamentos, no mesmo formato do app.
const crypto = require('crypto');

// Trecho do e-mail do remetente -> nome do hospital na agenda (formato com rótulos "Paciente:", "Médico:"...)
const HOSPITAIS = [
  ['hospitaldabaleia', 'Hospital da Baleia'],
  ['santacasabh.org.br', 'Santa Casa'],
  ['grupoorizonti.com.br', 'Grupo Orizonti'],
  ['administrativo@implaminas.com.br', 'Implaminas'],
];

const TZ = 'America/Sao_Paulo';

// O app mostra desc/obs via innerHTML: tiramos qualquer coisa que vire HTML.
function limpa(s) {
  return String(s || '')
    .replace(/[<>`]/g, '')
    .replace(/"/g, '”')
    .replace(/'/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hojeBR() {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
  return { y, m, d };
}

function refDe(recebido) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(recebido || ''));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

function parseData(txt, ref) {
  const m = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/.exec(txt || '');
  if (!m) return null;
  const dia = +m[1], mes = +m[2];
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  let ano;
  if (m[3]) {
    ano = +m[3];
    if (ano < 100) ano += 2000;
  } else {
    const h = ref || hojeBR();
    ano = h.y;
    // sem ano no e-mail: usa o ano do recebimento; se a data é mais de 7 dias antes dele, é do ano que vem
    if (Date.UTC(ano, mes - 1, dia) < Date.UTC(h.y, h.m - 1, h.d) - 7 * 86400000) ano += 1;
  }
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function parseHora(txt) {
  const m = /(\d{1,2})\s*[:hH]\s*(\d{2})?/.exec(txt || '');
  if (!m) return '';
  const hh = +m[1], mm = m[2] ? +m[2] : 0;
  if (hh > 23 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function ajustaMedico(medico) {
  return String(medico || '').trim().replace(/^(dra?)(?:\.\s*|\s+)/i, (_, d) => d[0].toUpperCase() + d.slice(1).toLowerCase() + ' ');
}

// Formato COM RÓTULOS (Paciente:/Nome:, Médico:, Data da Cirurgia:, Horário:, Procedimento:, Material...)
function parseEmail({ subject = '', from = '', body = '', recebido = '' }) {
  const ref = refDe(recebido);
  const linhas = String(body).replace(/\u00a0/g, ' ').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim());
  const pega = (re) => {
    for (const l of linhas) { const m = re.exec(l); if (m) return m[1].trim(); }
    return '';
  };

  let paciente = pega(/^(?:paciente|nome)\s*:\s*(.+)$/i);
  const convenio = pega(/^conv[eê]nio\s*:\s*(.+)$/i);
  const medico = ajustaMedico(pega(/^m[eé]dico\s*:\s*(.+)$/i));
  const procedimento = pega(/^procedimento\s*:\s*(.+)$/i);
  let dataTxt = pega(/^data(?:\s+da\s+cirurgia)?\s*:\s*(.+)$/i);
  let horaTxt = pega(/^hor[aá]rio\s*:\s*(.+)$/i);

  // Formato "Nome: Fulano - Cir. dia 25/11 - 17:00"
  const mc = /\s*[-–—]\s*cir(?:urgia|\.)\s*(?:dia\s*)?(.*)$/i.exec(paciente);
  if (mc) {
    const resto = mc[1];
    paciente = paciente.slice(0, mc.index).trim();
    if (!dataTxt) dataTxt = resto;
    if (!horaTxt) horaTxt = resto.replace(/\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?/, '');
  }
  // Último recurso: "cirurgia dia 25/11" em qualquer lugar do texto
  if (!dataTxt) {
    const m = /cir(?:urgia|\.)\s*(?:dia)?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i.exec(linhas.join(' '));
    if (m) dataTxt = m[1];
  }

  // Lista de material: linhas logo depois de "Material a ser utilizado:" / "MATERIAIS:"
  const material = [];
  const iMat = linhas.findIndex(l => /^materia(?:l|is)\b[^:]*:/i.test(l));
  if (iMat >= 0) {
    const inline = linhas[iMat].replace(/^[^:]*:\s*/, '');
    if (inline) material.push(inline);
    for (let i = iMat + 1; i < linhas.length && material.length < 15; i++) {
      const l = linhas[i];
      if (!l) { if (material.length) break; else continue; }
      if (/^(att|atenciosamente|obrigad|cordialmente|de:|enviado|para:)/i.test(l)) break;
      material.push(l);
    }
  }
  const entrega = linhas.find(l => /^entregar\b/i.test(l)) || '';

  const f = String(from).toLowerCase();
  const hit = HOSPITAIS.find(([k]) => f.includes(k));
  const hospital = hit ? hit[1] : (f.split('@')[1] || '').trim();

  return {
    hospital, hospitalConhecido: !!hit, medico, paciente, convenio, procedimento,
    data: parseData(dataTxt, ref), hora: parseHora(horaTxt), material, entrega,
  };
}

// Formato LISTA SEM RÓTULOS (secretária): data no ASSUNTO ("CIRURGIA 02/12/26") e, no corpo,
// um bloco por cirurgia:  "07:00 Hosp Materdei Nova Lima" / paciente / procedimento (Dr X) / convênio
function parseLista({ subject = '', body = '', recebido = '' }) {
  const ref = refDe(recebido);
  const data = parseData(subject, ref);
  if (!data) return [];

  const linhas = String(body).replace(/\u00a0/g, ' ').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim());
  const blocos = [];
  let atual = null;
  for (const l of linhas) {
    if (/^--/.test(l) || /^(att|atenciosamente|obrigad|cordialmente)\b/i.test(l)) break; // assinatura
    if (!l) continue;
    const m = /^(\d{1,2}\s*[:hH]\s*\d{2})\s*(.*)$/.exec(l);
    if (m) { atual = { hora: parseHora(m[1]), hospital: m[2], resto: [] }; blocos.push(atual); }
    else if (atual) atual.resto.push(l);
  }

  return blocos.filter(b => b.resto.length).map(b => {
    const paciente = b.resto[0];
    let proc = b.resto[1] || '';
    let medico = '';
    const pm = /\(\s*(dra?\.?\s*[^)]*)\)/i.exec(proc);
    if (pm) { medico = ajustaMedico(pm[1]); proc = proc.replace(pm[0], ' ').replace(/\s+/g, ' ').trim(); }
    const convenio = b.resto[2] || '';
    const extras = b.resto.slice(3).join('; ');
    const hospital = b.hospital.replace(/^hosp\.?\s+/i, 'Hospital ').trim();
    return { hospital, hospitalConhecido: true, medico, paciente, convenio, procedimento: proc,
             data, hora: b.hora, material: [], entrega: '', extras };
  });
}

function iguais(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function montaRegistro(d) {
  const desc = [d.hospital, d.medico, d.paciente, d.procedimento].filter(Boolean).map(limpa).join(' - ');
  const obs = [
    '📧 Importado do e-mail — conferir',
    d.convenio && 'Convênio: ' + d.convenio,
    d.material && d.material.length && 'Material: ' + d.material.join('; ').slice(0, 400),
    d.extras,
    d.entrega,
  ].filter(Boolean).map(limpa).join(' | ');
  // id fixo por dia+paciente: o mesmo e-mail chegando de novo não duplica
  const id = 'agdm' + crypto.createHash('sha1').update(`${d.data}|${norm(d.paciente)}`).digest('hex').slice(0, 16);
  return { id, data: d.data, hora: d.hora, desc, tipo: 'entrega', obs, updatedAt: Date.now() };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const esperado = String(process.env.EMAIL_TOKEN || '');
  if (!esperado || !iguais(String(req.headers['x-token'] || ''), esperado)) {
    return res.status(401).json({ error: 'token inválido' });
  }

  const { subject = '', from = '', body = '', forcar = false, recebido = '' } = req.body || {};
  const u = String(subject).trim().toUpperCase();
  if (!forcar) {
    if (!u.includes('AGENDAMENTO') && !/^CIRURGIA\b/.test(u)) {
      return res.status(200).json({ ok: true, ignorado: 'assunto sem AGENDAMENTO/CIRURGIA' });
    }
    if (/^(RES|RE|ENC|FW|FWD)\s*:/.test(u)) return res.status(200).json({ ok: true, ignorado: 'é resposta/encaminhamento' });
  }

  const corpo = String(body).slice(0, 20000);
  const d = parseEmail({ subject, from, body: corpo, recebido });
  let itens = d.paciente && d.data ? [d] : parseLista({ subject, body: corpo, recebido });
  itens = itens.filter(x => x.paciente && x.data);
  if (!itens.length) {
    return res.status(422).json({ error: 'não achei paciente e/ou data no e-mail', lido: d });
  }

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL: process.env.FIREBASE_DB_URL,
      });
    }
    const colecao = admin.database().ref('medvisit/dados/agendamentos');
    const todos = (await colecao.once('value')).val() || {};

    const feitos = [];
    for (const item of itens) {
      const rec = montaRegistro(item);
      if (todos[rec.id]) { feitos.push({ id: rec.id, existente: true }); continue; }
      // já existe compromisso no mesmo dia com o nome do paciente (ex.: criado à mão)?
      const chave = norm(item.paciente).split(' ').filter(Boolean).slice(0, 2).join(' ');
      const parecido = chave.length >= 4 &&
        Object.values(todos).find(a => a && a.data === rec.data && norm(a.desc).includes(chave));
      if (parecido) { feitos.push({ id: parecido.id, existente: true, motivo: 'já havia compromisso do paciente nesse dia' }); continue; }
      await colecao.child(rec.id).set(rec);
      todos[rec.id] = rec;
      feitos.push({ id: rec.id, data: rec.data, hora: rec.hora, desc: rec.desc });
    }

    const novos = feitos.filter(f => !f.existente);
    if (!novos.length) return res.status(200).json({ ok: true, existente: true, total: feitos.length, itens: feitos });
    return res.status(200).json({ ok: true, total: feitos.length, novos: novos.length, itens: feitos });
  } catch (e) {
    console.error('email-agenda', e);
    return res.status(500).json({ error: 'falha ao gravar no Firebase' });
  }
}

module.exports = handler;
module.exports.parseEmail = parseEmail;
module.exports.parseLista = parseLista;
