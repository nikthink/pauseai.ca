const REPRESENT_ENDPOINT = 'https://represent.opennorth.ca/postcodes/';

const UI_TEXT = {
  en: {
    statusCopied: 'Email text copied.',
    statusOpening: 'Opening your email app…',
    errorPostalCode: 'Enter a valid Canadian postal code, for example H2X 1Y4.',
    errorLookup: 'Could not find a matching MP for that postal code.',
    errorEmail: 'No MP email address was found. You can still copy the text below.',
    errorUnexpected: 'Something went wrong while looking up the MP.',
  },
  fr: {
    statusCopied: 'Le texte du courriel a été copié.',
    statusOpening: 'Ouverture de votre application de messagerie…',
    errorPostalCode: 'Entrez un code postal canadien valide, par exemple H2X 1Y4.',
    errorLookup: 'Aucun·e député·e trouvé·e pour ce code postal.',
    errorEmail: "Aucune adresse courriel trouvée pour votre député·e. Vous pouvez quand même copier le texte ci-dessous.",
    errorUnexpected: "Une erreur s'est produite lors de la recherche de votre député·e.",
  },
};

// Substitutes {variable} placeholders in a template string.
function interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

function normalizePostalCode(value) {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return null;
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function buildMailtoUrl({ to, cc, bcc, subject, body }) {
  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  if (bcc) params.set('bcc', bcc);
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const query = params.toString();
  return query ? `mailto:${encodeURIComponent(to || '')}?${query}` : `mailto:${encodeURIComponent(to || '')}`;
}

async function lookupMpByPostalCode(postalCode) {
  const compact = postalCode.replace(/\s+/g, '');
  const response = await fetch(`${REPRESENT_ENDPOINT}${compact}/`);
  if (!response.ok) throw new Error(`Represent lookup failed: ${response.status}`);

  const payload = await response.json();
  const representatives = Array.isArray(payload.representatives_centroid)
    ? payload.representatives_centroid
    : [];

  const seen = new Set();
  return representatives
    .filter((rep) => rep.elected_office === 'MP')
    .map((rep) => ({ name: rep.name || '', email: rep.email || '', districtName: rep.district_name || '', party: rep.party_name || '' }))
    .filter(({ name, email }) => {
      const key = `${name}|${email}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function qs(root, selector) {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

function initCampaignEmail(root) {
  // Read campaign config embedded by Hugo
  const configEl = root.querySelector('[data-role="campaign-config"]');
  const config = configEl ? JSON.parse(configEl.textContent) : {};

  const locale = root.dataset.locale === 'fr' ? 'fr' : 'en';
  const text = UI_TEXT[locale];

  const form = qs(root, 'form');
  const nameInput = qs(root, '[name="name"]');
  const postalCodeInput = qs(root, '[name="postalCode"]');
  const toInput = qs(root, '[name="to"]');
  const ccInput = qs(root, '[name="cc"]');
  const bccInput = qs(root, '[name="bcc"]');
  const subjectInput = qs(root, '[name="subject"]');
  const bodyInput = qs(root, '[name="body"]');
  const lookupError = qs(root, '[data-role="lookup-error"]');
  const statusNode = qs(root, '[data-role="status"]');
  const mpPanel = qs(root, '[data-role="mp-panel"]');
  const mpList = qs(root, '[data-role="mp-list"]');

  // Initialise from config
  bccInput.value = config.bcc || '';
  ccInput.value = config.cc || '';

  let currentCandidates = [];

  function clearMessages() {
    lookupError.hidden = true;
    lookupError.textContent = '';
    statusNode.textContent = '';
  }

  function setLookupError(msg) { lookupError.hidden = false; lookupError.textContent = msg; }
  function setStatus(msg) { statusNode.textContent = msg; }

  function selectedMode() {
    return form.querySelector('input[name="draftLanguage"]:checked')?.value || 'bilingual';
  }

  function buildDraft(mode, mp) {
    const emailConfig =
      mode === 'en' ? config.emailEn :
      mode === 'fr' ? config.emailFr :
      config.emailBilingual;

    if (!emailConfig) return { subject: '', body: '' };

    const vars = {
      mpName: mp?.name || (mode === 'fr' ? 'Madame la députée, Monsieur le député' : 'Member of Parliament'),
      districtName: mp?.districtName || '',
      name: nameInput.value.trim(),
      postalCode: postalCodeInput.value.trim(),
    };

    return {
      subject: emailConfig.subject || '',
      body: interpolate(emailConfig.body || '', vars),
    };
  }

  function syncDraft() {
    const { subject, body } = buildDraft(selectedMode(), currentCandidates[0] ?? null);
    subjectInput.value = subject;
    bodyInput.value = body;
  }

  function checkedMpEmails() {
    if (currentCandidates.length <= 1) {
      return currentCandidates[0]?.email ? [currentCandidates[0].email] : [];
    }
    return [...mpList.querySelectorAll('input[type="checkbox"]:checked')]
      .map((cb) => currentCandidates[Number(cb.dataset.index)]?.email)
      .filter(Boolean);
  }

  function syncToField() {
    toInput.value = checkedMpEmails().join(', ');
  }

  function renderMPs(candidates) {
    mpList.innerHTML = '';

    candidates.forEach((mp, index) => {
      const card = document.createElement('div');
      card.className = 'campaign-email__mp-card';

      if (candidates.length > 1) {
        const label = document.createElement('label');
        label.className = 'campaign-email__mp-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.index = String(index);
        cb.addEventListener('change', () => { syncToField(); syncDraft(); });
        label.appendChild(cb);
        label.appendChild(mpCardInfo(mp));
        card.appendChild(label);
      } else {
        card.appendChild(mpCardInfo(mp));
      }

      mpList.appendChild(card);
    });

    syncToField();
  }

  function mpCardInfo(mp) {
    const div = document.createElement('div');
    div.className = 'campaign-email__mp-info';
    div.innerHTML = [
      `<strong>${mp.name}</strong>`,
      mp.districtName ? ` — ${mp.districtName}` : '',
      mp.party ? ` <span class="campaign-email__mp-party">(${mp.party})</span>` : '',
      mp.email ? `<br><span class="campaign-email__mp-email">${mp.email}</span>` : '',
    ].join('');
    return div;
  }

  async function performLookup() {
    clearMessages();
    const normalized = normalizePostalCode(postalCodeInput.value);
    if (!normalized) { setLookupError(text.errorPostalCode); return; }
    postalCodeInput.value = normalized;

    try {
      const candidates = await lookupMpByPostalCode(normalized);
      currentCandidates = candidates;

      if (candidates.length === 0) {
        mpPanel.hidden = true;
        toInput.value = '';
        setLookupError(text.errorLookup);
        return;
      }

      mpPanel.hidden = false;
      renderMPs(candidates);
      syncDraft();
    } catch (err) {
      console.error('[campaign-email] lookup error:', err);
      mpPanel.hidden = true;
      setLookupError(text.errorUnexpected);
    }
  }

  async function copyBody() {
    try {
      await navigator.clipboard.writeText(bodyInput.value);
      setStatus(text.statusCopied);
    } catch (err) {
      console.error(err);
    }
  }

  function openMailto() {
    clearMessages();
    if (!toInput.value) { setLookupError(text.errorEmail); return; }
    const url = buildMailtoUrl({
      to: toInput.value.trim(),
      cc: ccInput.value.trim(),
      bcc: bccInput.value.trim(),
      subject: subjectInput.value,
      body: bodyInput.value,
    });
    setStatus(text.statusOpening);
    window.location.href = url;
  }

  root.querySelector('[data-action="lookup"]')?.addEventListener('click', performLookup);
  root.querySelector('[data-action="copy-body"]')?.addEventListener('click', copyBody);
  root.querySelector('[data-action="open-mailto"]')?.addEventListener('click', openMailto);
  nameInput.addEventListener('input', syncDraft);
  postalCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); performLookup(); } });
  form.querySelectorAll('input[name="draftLanguage"]').forEach((r) => r.addEventListener('change', syncDraft));

  syncDraft();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-module="current-campaign-email"]').forEach((root) => {
    try { initCampaignEmail(root); }
    catch (err) { console.error('[campaign-email] init failed:', err); }
  });
});
