// Landing page translations. The app itself is English; only the marketing pages are translated.

export const LOCALES = ["en", "es", "de", "fr", "uk"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  uk: "Українська",
};

/** Short label on the language button; Ukrainian shows UA, which people expect, not the ISO code UK. */
export const LOCALE_BADGE: Record<Locale, string> = { en: "EN", es: "ES", de: "DE", fr: "FR", uk: "UA" };

export const isLocale = (v: string): v is Locale => (LOCALES as readonly string[]).includes(v);
export const homeHref = (l: Locale) => (l === "en" ? "/" : `/${l}`);

export interface Dict {
  meta: { title: string; description: string };
  nav: { problem: string; solution: string; accuracy: string; open: string; language: string };
  hero: { h1a: string; h1b: string; lede: string; try: string; upload: string; sample: string; connected: string };
  flow: { aria: string; k1: string; t1: string; from: string; ask: string; c2: string; k2: string; t2: string; d2: string; k3: string; t3: string; d3: string; chip: string };
  problem: { eyebrow: string; h2: string; items: { t: string; d: string }[] };
  quote: { text: string; note: string; source: string; translated: string };
  solution: { eyebrow: string; h2: string; steps: { t: string; d: string }[] };
  checks: {
    eyebrow: string;
    h2: string;
    names: Record<string, string>;
    populations: Record<string, string>;
    all: string;
    manual: string;
    instead: string;
    tip: string; // {n} {pop} {m}
  };
  cta: { h2: string; proof: string; button: string };
  footer: string;
}

const en: Dict = {
  meta: { title: "Tickmark · Audit evidence from Ramp", description: "Turns an auditor's request list into a cited evidence binder from Ramp data, and flags control problems before the auditor finds them." },
  nav: { problem: "Problem", solution: "Solution", accuracy: "Accuracy", open: "Open Tickmark", language: "Language" },
  hero: {
    h1a: "Your auditor’s request list,",
    h1b: "answered from Ramp.",
    lede: "Upload the request list. Get back a finished evidence binder, with every problem flagged first.",
    try: "Try it with a sample audit",
    upload: "Upload your list",
    sample: "The sample audit runs on a generated company.",
    connected: "Connected to {source}.",
  },
  flow: {
    aria: "What Tickmark does with one request",
    k1: "1 · The auditor asks",
    t1: "PBC-03 · Bills over $10,000",
    from: "Request from Hartwell & Co.",
    ask: "Invoice, approval and proof of payment for every bill over $10,000.",
    k2: "2 · Tickmark tests it in Ramp",
    t2: "31 bills tested",
    d2: "Invoices attached, approvals traced, payments matched.",
    c2: "Every bill checked, none sampled",
    k3: "3 · It flags what’s wrong",
    t3: "Paid Jun 2, approved Jun 9",
    d3: "Crestline Contract Manufacturing, $22,300.00",
    chip: "Follow-up drafted for the bill owner",
  },
  problem: {
    eyebrow: "The problem",
    h2: "Audit season still runs on email and screenshots.",
    items: [
      { t: "A spreadsheet of requests", d: "Dozens of asks: receipts, approvals, access lists." },
      { t: "Evidence is scattered", d: "Every answer is a receipt, a screenshot and a folder." },
      { t: "Problems show up late", d: "The auditor finds the gaps, weeks in." },
    ],
  },
  quote: {
    text: "Preparing for an audit means gathering receipts, matching transactions, and exporting clean records.",
    note: "When documentation is missing, Ramp notes, it “can take days.”",
    source: "Ramp blog, on audit preparation",
    translated: "",
  },
  solution: {
    eyebrow: "Our solution",
    h2: "Tickmark answers the list from data Ramp already has.",
    steps: [
      { t: "Upload", d: "The auditor's list, as a file or an email." },
      { t: "Gather", d: "Receipts, approvals and bills from Ramp." },
      { t: "Test", d: "The checks auditors run, on every record." },
      { t: "Hand over", d: "Approve follow-ups. Download the binder." },
    ],
  },
  checks: {
    eyebrow: "What it checks",
    h2: "The tests auditors run, on every record.",
    names: {},
    populations: {},
    all: "Tickmark checks every record",
    manual: "Manual sample of {m}",
    instead: "record checks instead of",
    tip: "{n} {pop} checked. A manual test would look at {m}.",
  },
  cta: { h2: "See it on a sample audit.", proof: "8 of 8 planted problems found, 0 false alarms", button: "Try the sample audit" },
  footer: "Tickmark. Built for the BBS x Ramp Hackathon.",
};

const es: Dict = {
  meta: { title: "Tickmark · Evidencia de auditoría desde Ramp", description: "Convierte la lista de solicitudes del auditor en un expediente de evidencia con datos de Ramp y señala los problemas de control antes que el auditor." },
  nav: { problem: "Problema", solution: "Solución", accuracy: "Precisión", open: "Abrir Tickmark", language: "Idioma" },
  hero: {
    h1a: "La lista de tu auditor,",
    h1b: "respondida desde Ramp.",
    lede: "Sube la lista de solicitudes. Recibe un expediente de evidencia terminado, con cada problema señalado primero.",
    try: "Probar con una auditoría de ejemplo",
    upload: "Subir tu lista",
    sample: "La auditoría de ejemplo usa una empresa generada.",
    connected: "Conectado a {source}.",
  },
  flow: {
    aria: "Qué hace Tickmark con una solicitud",
    k1: "1 · El auditor pide",
    t1: "PBC-03 · Facturas de más de 10.000 $",
    from: "Solicitud de Hartwell & Co.",
    ask: "Factura, aprobación y comprobante de pago de cada factura superior a 10.000 $.",
    k2: "2 · Tickmark lo comprueba en Ramp",
    t2: "31 facturas revisadas",
    d2: "Facturas adjuntas, aprobaciones rastreadas, pagos conciliados.",
    c2: "Cada factura revisada, sin muestreo",
    k3: "3 · Señala lo que falla",
    t3: "Pagada el 2 jun, aprobada el 9 jun",
    d3: "Crestline Contract Manufacturing, 22.300,00 $",
    chip: "Seguimiento redactado para el responsable",
  },
  problem: {
    eyebrow: "El problema",
    h2: "La temporada de auditoría sigue funcionando con correos y capturas.",
    items: [
      { t: "Una hoja de cálculo de solicitudes", d: "Decenas de peticiones: recibos, aprobaciones, accesos." },
      { t: "La evidencia está dispersa", d: "Cada respuesta es un recibo, una captura y una carpeta." },
      { t: "Los problemas llegan tarde", d: "El auditor encuentra los fallos semanas después." },
    ],
  },
  quote: {
    text: "Prepararse para una auditoría significa reunir recibos, conciliar transacciones y exportar registros limpios.",
    note: "Cuando falta documentación, señala Ramp, “puede llevar días”.",
    source: "Blog de Ramp, sobre la preparación de auditorías",
    translated: "Traducción",
  },
  solution: {
    eyebrow: "Nuestra solución",
    h2: "Tickmark responde la lista con datos que Ramp ya tiene.",
    steps: [
      { t: "Subir", d: "La lista del auditor, como archivo o correo." },
      { t: "Reunir", d: "Recibos, aprobaciones y facturas desde Ramp." },
      { t: "Comprobar", d: "Las pruebas del auditor, en cada registro." },
      { t: "Entregar", d: "Aprueba seguimientos. Descarga el expediente." },
    ],
  },
  checks: {
    eyebrow: "Qué comprueba",
    h2: "Las pruebas del auditor, en cada registro.",
    names: {
      "Missing receipts": "Recibos faltantes",
      "Receipt mismatches": "Recibos que no cuadran",
      "Split purchases": "Compras fraccionadas",
      "Self-approval": "Autoaprobación",
      "Approval after payment": "Aprobación tras el pago",
      "Duplicate invoices": "Facturas duplicadas",
      "Fast-paid new vendors": "Proveedores nuevos pagados rápido",
      "Restricted merchants": "Comercios restringidos",
    },
    populations: {
      "card charges at or above the receipt threshold": "cargos de tarjeta sobre el umbral de recibo",
      "card charges with a receipt": "cargos de tarjeta con recibo",
      "card charges": "cargos de tarjeta",
      "card charges and bills": "cargos de tarjeta y facturas",
      "paid bills": "facturas pagadas",
      bills: "facturas",
      vendors: "proveedores",
    },
    all: "Tickmark revisa cada registro",
    manual: "Muestra manual de {m}",
    instead: "comprobaciones en lugar de",
    tip: "{n} {pop} revisados. Una prueba manual miraría {m}.",
  },
  cta: { h2: "Míralo en una auditoría de ejemplo.", proof: "8 de 8 problemas sembrados encontrados, 0 falsas alarmas", button: "Probar la auditoría de ejemplo" },
  footer: "Tickmark. Creado para el BBS x Ramp Hackathon.",
};

const de: Dict = {
  meta: { title: "Tickmark · Prüfungsnachweise aus Ramp", description: "Macht aus der Anforderungsliste des Prüfers einen belegten Nachweisordner aus Ramp-Daten und meldet Kontrollprobleme, bevor der Prüfer sie findet." },
  nav: { problem: "Problem", solution: "Lösung", accuracy: "Genauigkeit", open: "Tickmark öffnen", language: "Sprache" },
  hero: {
    h1a: "Die Liste Ihres Prüfers,",
    h1b: "beantwortet aus Ramp.",
    lede: "Laden Sie die Anforderungsliste hoch. Sie erhalten einen fertigen Nachweisordner, mit jedem Problem vorab markiert.",
    try: "Mit einer Beispielprüfung testen",
    upload: "Eigene Liste hochladen",
    sample: "Die Beispielprüfung läuft auf einem generierten Unternehmen.",
    connected: "Verbunden mit {source}.",
  },
  flow: {
    aria: "Was Tickmark mit einer Anforderung macht",
    k1: "1 · Der Prüfer fragt",
    t1: "PBC-03 · Rechnungen über 10.000 $",
    from: "Anforderung von Hartwell & Co.",
    ask: "Rechnung, Freigabe und Zahlungsnachweis für jede Rechnung über 10.000 $.",
    k2: "2 · Tickmark prüft es in Ramp",
    t2: "31 Rechnungen geprüft",
    d2: "Rechnungen angehängt, Freigaben nachverfolgt, Zahlungen abgeglichen.",
    c2: "Jede Rechnung geprüft, keine Stichprobe",
    k3: "3 · Es meldet, was nicht stimmt",
    t3: "Bezahlt am 2. Juni, freigegeben am 9. Juni",
    d3: "Crestline Contract Manufacturing, 22.300,00 $",
    chip: "Nachfrage an den Verantwortlichen entworfen",
  },
  problem: {
    eyebrow: "Das Problem",
    h2: "Die Prüfungssaison läuft noch über E-Mails und Screenshots.",
    items: [
      { t: "Eine Tabelle voller Anforderungen", d: "Dutzende Anfragen: Belege, Freigaben, Zugriffslisten." },
      { t: "Nachweise sind verstreut", d: "Jede Antwort ist ein Beleg, ein Screenshot und ein Ordner." },
      { t: "Probleme kommen spät", d: "Der Prüfer findet die Lücken erst nach Wochen." },
    ],
  },
  quote: {
    text: "Die Vorbereitung auf eine Prüfung bedeutet, Belege zu sammeln, Transaktionen abzugleichen und saubere Datensätze zu exportieren.",
    note: "Wenn Unterlagen fehlen, so Ramp, „kann das Tage dauern“.",
    source: "Ramp-Blog, zur Prüfungsvorbereitung",
    translated: "Übersetzung",
  },
  solution: {
    eyebrow: "Unsere Lösung",
    h2: "Tickmark beantwortet die Liste mit Daten, die Ramp schon hat.",
    steps: [
      { t: "Hochladen", d: "Die Liste des Prüfers, als Datei oder E-Mail." },
      { t: "Sammeln", d: "Belege, Freigaben und Rechnungen aus Ramp." },
      { t: "Prüfen", d: "Die Tests des Prüfers, für jeden Datensatz." },
      { t: "Übergeben", d: "Nachfragen freigeben. Ordner herunterladen." },
    ],
  },
  checks: {
    eyebrow: "Was es prüft",
    h2: "Die Tests des Prüfers, für jeden Datensatz.",
    names: {
      "Missing receipts": "Fehlende Belege",
      "Receipt mismatches": "Abweichende Belege",
      "Split purchases": "Aufgeteilte Käufe",
      "Self-approval": "Selbstfreigabe",
      "Approval after payment": "Freigabe nach Zahlung",
      "Duplicate invoices": "Doppelte Rechnungen",
      "Fast-paid new vendors": "Schnell bezahlte neue Lieferanten",
      "Restricted merchants": "Gesperrte Händler",
    },
    populations: {
      "card charges at or above the receipt threshold": "Kartenzahlungen ab der Belegschwelle",
      "card charges with a receipt": "Kartenzahlungen mit Beleg",
      "card charges": "Kartenzahlungen",
      "card charges and bills": "Kartenzahlungen und Rechnungen",
      "paid bills": "bezahlte Rechnungen",
      bills: "Rechnungen",
      vendors: "Lieferanten",
    },
    all: "Tickmark prüft jeden Datensatz",
    manual: "Manuelle Stichprobe von {m}",
    instead: "Prüfungen statt",
    tip: "{n} {pop} geprüft. Ein manueller Test sähe {m} an.",
  },
  cta: { h2: "Sehen Sie es in einer Beispielprüfung.", proof: "8 von 8 eingebauten Problemen gefunden, 0 Fehlalarme", button: "Beispielprüfung starten" },
  footer: "Tickmark. Entwickelt für den BBS x Ramp Hackathon.",
};

const fr: Dict = {
  meta: { title: "Tickmark · Preuves d’audit depuis Ramp", description: "Transforme la liste de demandes de l’auditeur en dossier de preuves sourcé à partir des données Ramp, et signale les problèmes de contrôle avant l’auditeur." },
  nav: { problem: "Problème", solution: "Solution", accuracy: "Précision", open: "Ouvrir Tickmark", language: "Langue" },
  hero: {
    h1a: "La liste de votre auditeur,",
    h1b: "traitée depuis Ramp.",
    lede: "Importez la liste de demandes. Récupérez un dossier de preuves complet, chaque problème signalé d’avance.",
    try: "Essayer avec un audit d’exemple",
    upload: "Importer votre liste",
    sample: "L’audit d’exemple utilise une entreprise générée.",
    connected: "Connecté à {source}.",
  },
  flow: {
    aria: "Ce que fait Tickmark d’une demande",
    k1: "1 · L’auditeur demande",
    t1: "PBC-03 · Factures de plus de 10 000 $",
    from: "Demande de Hartwell & Co.",
    ask: "Facture, approbation et preuve de paiement pour chaque facture de plus de 10 000 $.",
    k2: "2 · Tickmark le vérifie dans Ramp",
    t2: "31 factures vérifiées",
    d2: "Factures jointes, approbations retracées, paiements rapprochés.",
    c2: "Chaque facture vérifiée, sans échantillon",
    k3: "3 · Il signale ce qui cloche",
    t3: "Payée le 2 juin, approuvée le 9 juin",
    d3: "Crestline Contract Manufacturing, 22 300,00 $",
    chip: "Relance rédigée pour le responsable",
  },
  problem: {
    eyebrow: "Le problème",
    h2: "La saison d’audit se fait encore par e-mails et captures d’écran.",
    items: [
      { t: "Un tableur de demandes", d: "Des dizaines de requêtes : reçus, approbations, accès." },
      { t: "Des preuves éparpillées", d: "Chaque réponse est un reçu, une capture et un dossier." },
      { t: "Les problèmes arrivent tard", d: "L’auditeur trouve les écarts des semaines après." },
    ],
  },
  quote: {
    text: "Préparer un audit, c’est rassembler les reçus, rapprocher les transactions et exporter des registres propres.",
    note: "Quand des pièces manquent, note Ramp, cela « peut prendre des jours ».",
    source: "Blog Ramp, sur la préparation d’audit",
    translated: "Traduction",
  },
  solution: {
    eyebrow: "Notre solution",
    h2: "Tickmark répond à la liste avec les données que Ramp possède déjà.",
    steps: [
      { t: "Importer", d: "La liste de l’auditeur, en fichier ou e-mail." },
      { t: "Rassembler", d: "Reçus, approbations et factures depuis Ramp." },
      { t: "Tester", d: "Les contrôles de l’auditeur, sur chaque ligne." },
      { t: "Remettre", d: "Validez les relances. Téléchargez le dossier." },
    ],
  },
  checks: {
    eyebrow: "Ce qu’il vérifie",
    h2: "Les contrôles de l’auditeur, sur chaque ligne.",
    names: {
      "Missing receipts": "Reçus manquants",
      "Receipt mismatches": "Reçus non concordants",
      "Split purchases": "Achats fractionnés",
      "Self-approval": "Auto-approbation",
      "Approval after payment": "Approbation après paiement",
      "Duplicate invoices": "Factures en double",
      "Fast-paid new vendors": "Nouveaux fournisseurs payés vite",
      "Restricted merchants": "Commerçants interdits",
    },
    populations: {
      "card charges at or above the receipt threshold": "paiements par carte au-dessus du seuil de reçu",
      "card charges with a receipt": "paiements par carte avec reçu",
      "card charges": "paiements par carte",
      "card charges and bills": "paiements par carte et factures",
      "paid bills": "factures payées",
      bills: "factures",
      vendors: "fournisseurs",
    },
    all: "Tickmark vérifie chaque ligne",
    manual: "Échantillon manuel de {m}",
    instead: "vérifications au lieu de",
    tip: "{n} {pop} vérifiés. Un test manuel en regarderait {m}.",
  },
  cta: { h2: "Voyez-le sur un audit d’exemple.", proof: "8 problèmes cachés sur 8 trouvés, 0 fausse alerte", button: "Lancer l’audit d’exemple" },
  footer: "Tickmark. Créé pour le BBS x Ramp Hackathon.",
};

const uk: Dict = {
  meta: { title: "Tickmark · Аудиторські докази з Ramp", description: "Перетворює список запитів аудитора на теку доказів із даних Ramp і позначає проблеми з контролем раніше, ніж їх знайде аудитор." },
  nav: { problem: "Проблема", solution: "Рішення", accuracy: "Точність", open: "Відкрити Tickmark", language: "Мова" },
  hero: {
    h1a: "Список запитів вашого аудитора,",
    h1b: "з відповідями з Ramp.",
    lede: "Завантажте список запитів. Отримайте готову теку доказів, де кожну проблему позначено заздалегідь.",
    try: "Спробувати на прикладі аудиту",
    upload: "Завантажити свій список",
    sample: "Приклад аудиту працює на згенерованій компанії.",
    connected: "Підключено до {source}.",
  },
  flow: {
    aria: "Що Tickmark робить з одним запитом",
    k1: "1 · Аудитор запитує",
    t1: "PBC-03 · Рахунки понад $10 000",
    from: "Запит від Hartwell & Co.",
    ask: "Рахунок, погодження і підтвердження оплати для кожного рахунку понад $10 000.",
    k2: "2 · Tickmark перевіряє це в Ramp",
    t2: "Перевірено 31 рахунок",
    d2: "Рахунки додані, погодження відстежені, оплати звірені.",
    c2: "Перевірено кожен рахунок, без вибірки",
    k3: "3 · Позначає, що не так",
    t3: "Оплачено 2 червня, погоджено 9 червня",
    d3: "Crestline Contract Manufacturing, $22 300,00",
    chip: "Запит власнику рахунку підготовлено",
  },
  problem: {
    eyebrow: "Проблема",
    h2: "Аудит досі тримається на листах і скриншотах.",
    items: [
      { t: "Таблиця запитів", d: "Десятки прохань: чеки, погодження, списки доступу." },
      { t: "Докази розкидані", d: "Кожна відповідь це чек, скриншот і папка." },
      { t: "Проблеми видно запізно", d: "Аудитор знаходить прогалини через тижні." },
    ],
  },
  quote: {
    text: "Підготовка до аудиту означає зібрати чеки, звірити транзакції та вивантажити чисті записи.",
    note: "Коли документів бракує, зазначає Ramp, це «може зайняти дні».",
    source: "Блог Ramp, про підготовку до аудиту",
    translated: "Переклад",
  },
  solution: {
    eyebrow: "Наше рішення",
    h2: "Tickmark відповідає на список даними, які вже є в Ramp.",
    steps: [
      { t: "Завантажити", d: "Список аудитора, файлом або листом." },
      { t: "Зібрати", d: "Чеки, погодження й рахунки з Ramp." },
      { t: "Перевірити", d: "Перевірки аудитора, для кожного запису." },
      { t: "Передати", d: "Погодьте запити. Завантажте теку." },
    ],
  },
  checks: {
    eyebrow: "Що перевіряє",
    h2: "Перевірки аудитора, для кожного запису.",
    names: {
      "Missing receipts": "Відсутні чеки",
      "Receipt mismatches": "Чеки не збігаються",
      "Split purchases": "Розбиті покупки",
      "Self-approval": "Самопогодження",
      "Approval after payment": "Погодження після оплати",
      "Duplicate invoices": "Дубльовані рахунки",
      "Fast-paid new vendors": "Нові постачальники, оплачені швидко",
      "Restricted merchants": "Заборонені продавці",
    },
    populations: {
      "card charges at or above the receipt threshold": "платежів карткою від порогу чека",
      "card charges with a receipt": "платежів карткою з чеком",
      "card charges": "платежів карткою",
      "card charges and bills": "платежів карткою і рахунків",
      "paid bills": "оплачених рахунків",
      bills: "рахунків",
      vendors: "постачальників",
    },
    all: "Tickmark перевіряє кожен запис",
    manual: "Ручна вибірка з {m}",
    instead: "перевірок замість",
    tip: "Перевірено {n} {pop}. Ручний тест подивився б {m}.",
  },
  cta: { h2: "Подивіться на прикладі аудиту.", proof: "Знайдено 8 з 8 прихованих проблем, 0 хибних тривог", button: "Спробувати приклад аудиту" },
  footer: "Tickmark. Створено для BBS x Ramp Hackathon.",
};

export const DICTS: Record<Locale, Dict> = { en, es, de, fr, uk };
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
