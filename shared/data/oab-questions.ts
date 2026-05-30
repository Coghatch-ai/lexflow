/* eslint-disable max-lines -- data module: the question bank is large by nature. */
// shared/data/oab-questions.ts
//
// Canonical OAB question bank + a deterministic generator used by the seed
// (scripts/seed.ts). Discipline names match app/src/types.ts (accented). The
// generator expands a handful of templates per discipline across exam boards,
// years and difficulties to produce a stable (re-runnable) set of questions.

export type QuestionTemplate = {
  q: string;
  opts: string[];
  correct: string;
  basis: string;
  explanation: string;
  legTitle: string;
  topic: string;
};

export const DISCIPLINES = [
  "Direito Constitucional",
  "Direito Civil",
  "Direito Penal",
  "Direito Processual Civil",
  "Direito Processual Penal",
  "Direito Administrativo",
  "Direito Tributário",
  "Direito Trabalhista",
  "Direito Comercial",
  "Direito Ambiental",
  "Ética Profissional",
] as const;

export const EXAM_BOARDS = ["FGV", "CESPE"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024] as const;

export const QUESTION_TEMPLATES: Record<string, QuestionTemplate[]> = {
  "Direito Constitucional": [
    {
      q: "A Constituicao Federal de 1988 e considerada:",
      opts: ["Flexivel", "Rigida", "Semirrigida", "Inflexivel"],
      correct: "Rigida",
      basis: "CF/88, Art. 60",
      explanation: "A CF/88 e rigida pois exige processo legislativo especial para emendas.",
      legTitle: "Constituicao Federal",
      topic: "Caracteristicas da CF/88",
    },
    {
      q: "Qual e um fundamento da Republica Federativa do Brasil?",
      opts: [
        "Livre iniciativa",
        "Dignidade da pessoa humana",
        "Desenvolvimento nacional",
        "Pluralismo politico",
      ],
      correct: "Dignidade da pessoa humana",
      basis: "CF/88, Art. 1, III",
      explanation: "A dignidade da pessoa humana e fundamento da Republica.",
      legTitle: "Constituicao Federal",
      topic: "Fundamentos",
    },
    {
      q: "O direito a vida e classificado como direito:",
      opts: ["Social", "Politico", "Individual", "Difuso"],
      correct: "Individual",
      basis: "CF/88, Art. 5, caput",
      explanation: "O direito a vida e um direito fundamental individual.",
      legTitle: "Constituicao Federal",
      topic: "Direitos Fundamentais",
    },
    {
      q: "O habeas corpus e utilizado para proteger:",
      opts: ["O patrimonio", "A liberdade de locomocao", "O honorario", "A intimidade"],
      correct: "A liberdade de locomocao",
      basis: "CF/88, Art. 5, LXVIII",
      explanation: "O habeas corpus protege a liberdade de locomocao.",
      legTitle: "Constituicao Federal",
      topic: "Remedios Constitucionais",
    },
    {
      q: "O mandado de seguranca protege direito liquido e certo nao amparado por:",
      opts: [
        "Habeas corpus ou habeas data",
        "Acao popular ou acao civil publica",
        "Acao rescisoria ou revisao criminal",
        "Recurso especial ou extraordinario",
      ],
      correct: "Habeas corpus ou habeas data",
      basis: "CF/88, Art. 5, LXIX",
      explanation: "O MS protege direito liquido e certo nao amparado por HC ou HD.",
      legTitle: "Constituicao Federal",
      topic: "Remedios Constitucionais",
    },
  ],
  "Direito Civil": [
    {
      q: "A capacidade civil e classificada em:",
      opts: [
        "Capacidade de direito e de fato",
        "Capacidade ativa e passiva",
        "Capacidade absoluta e relativa",
        "Capacidade civil e comercial",
      ],
      correct: "Capacidade de direito e de fato",
      basis: "CC/2002, Art. 1-6",
      explanation: "Capacidade de direito (titularidade) e de fato (exercicio).",
      legTitle: "Codigo Civil",
      topic: "Pessoa e Capacidade",
    },
    {
      q: "O negocio juridico nulo pode ser:",
      opts: [
        "Convalidado a qualquer tempo",
        "Confirmado tacitamente",
        "Declarado nulo de pleno direito",
        "Ratificado pelas partes",
      ],
      correct: "Declarado nulo de pleno direito",
      basis: "CC/2002, Art. 166",
      explanation: "O negocio nulo nao produz efeitos e nao pode ser convalidado.",
      legTitle: "Codigo Civil",
      topic: "Negocio Juridico",
    },
    {
      q: "A prescricao extintiva ocorre quando:",
      opts: [
        "O credor renuncia ao credito",
        "O devedor paga a divida",
        "O credor nao exerce o direito no prazo legal",
        "As partes acordam a extincao",
      ],
      correct: "O credor nao exerce o direito no prazo legal",
      basis: "CC/2002, Art. 189",
      explanation: "A prescricao extintiva ocorre pela inercia do titular no prazo legal.",
      legTitle: "Codigo Civil",
      topic: "Prescricao",
    },
    {
      q: "A posse direta e aquela exercida por:",
      opts: [
        "O proprietario",
        "O possuidor indireto",
        "Quem tem a coisa em virtude de direito real",
        "O herdeiro",
      ],
      correct: "Quem tem a coisa em virtude de direito real",
      basis: "CC/2002, Art. 1197",
      explanation: "A posse direta e exercida por detentor de direito real sobre a coisa.",
      legTitle: "Codigo Civil",
      topic: "Posse",
    },
    {
      q: "O contrato de compra e venda e:",
      opts: ["Real", "Solene", "Consensual", "Gratuito"],
      correct: "Consensual",
      basis: "CC/2002, Art. 481",
      explanation: "A compra e venda se perfaz com o consentimento, sendo consensual.",
      legTitle: "Codigo Civil",
      topic: "Contratos",
    },
  ],
  "Direito Penal": [
    {
      q: "O principio da legalidade penal estabelece:",
      opts: [
        "Que so existe crime se houver dolo",
        "Que nao ha crime sem lei anterior que o defina",
        "Que o juiz pode criar crimes",
        "Que qualquer ato e crime",
      ],
      correct: "Que nao ha crime sem lei anterior que o defina",
      basis: "CF/88, Art. 5, XXXIX; CP, Art. 1",
      explanation: "Nullum crimen sine lege: nao ha crime sem lei anterior.",
      legTitle: "Codigo Penal",
      topic: "Principios",
    },
    {
      q: "O homicidio qualificado tem pena de:",
      opts: ["6 meses a 1 ano", "1 a 3 anos", "12 a 30 anos", "30 a 40 anos"],
      correct: "12 a 30 anos",
      basis: "CP, Art. 121, 2",
      explanation: "O homicidio qualificado tem pena de 12 a 30 anos.",
      legTitle: "Codigo Penal",
      topic: "Crimes Contra a Vida",
    },
    {
      q: "A legitima defesa exige:",
      opts: [
        "Agressao injusta, atual ou iminente",
        "Agressao futura e hipotetica",
        "Agressao passada e consumada",
        "Agressao justa e proporcional",
      ],
      correct: "Agressao injusta, atual ou iminente",
      basis: "CP, Art. 25",
      explanation: "A legítima defesa pressupoe agressao injusta, atual ou iminente.",
      legTitle: "Codigo Penal",
      topic: "Excludentes de Ilicitude",
    },
    {
      q: "O crime tentado ocorre quando:",
      opts: [
        "O agente desiste voluntariamente",
        "O crime nao se consuma por circunstancias alheias a vontade",
        "O agente impede o resultado",
        "O agente se arrepende apos o fato",
      ],
      correct: "O crime nao se consuma por circunstancias alheias a vontade",
      basis: "CP, Art. 14, II",
      explanation: "A tentativa ocorre quando o crime nao se consuma por razoes externas.",
      legTitle: "Codigo Penal",
      topic: "Tentativa",
    },
    {
      q: "O dolo direto e caracterizado quando o agente:",
      opts: [
        "Prevê o resultado como possivel",
        "Quer o resultado como fim",
        "Nao prevê o resultado",
        "Aceita o risco de produzir resultado",
      ],
      correct: "Quer o resultado como fim",
      basis: "CP, Art. 18, I",
      explanation: "Dolo direto: o agente quer o resultado como fim de sua conduta.",
      legTitle: "Codigo Penal",
      topic: "Dolo e Culpa",
    },
  ],
  "Direito Processual Civil": [
    {
      q: "O CPC atual e de qual ano?",
      opts: ["1973", "1988", "2015", "2020"],
      correct: "2015",
      basis: "Lei 13.105/2015",
      explanation: "O CPC/2015 entrou em vigor em 18/03/2016.",
      legTitle: "Codigo de Processo Civil",
      topic: "Noções Gerais",
    },
    {
      q: "A competencia territorial e definida por:",
      opts: [
        "O local onde reside o juiz",
        "O local do tribunal",
        "O domicilio do reu",
        "A vontade das partes",
      ],
      correct: "O domicilio do reu",
      basis: "CPC, Art. 46-52",
      explanation: "Regra geral: foro do domicilio do reu.",
      legTitle: "Codigo de Processo Civil",
      topic: "Competencia",
    },
    {
      q: "A tutela provisoria de urgencia antecipada requer:",
      opts: [
        "Prova inequivoca e perigo de dano",
        "Apenas probabilidade do direito",
        "Certeza absoluta do direito",
        "Concordancia da parte contraria",
      ],
      correct: "Prova inequivoca e perigo de dano",
      basis: "CPC, Art. 303",
      explanation:
        "A antecipacao requer prova inequivoca e perigo de dano ou risco ao resultado util.",
      legTitle: "Codigo de Processo Civil",
      topic: "Tutela Provisoria",
    },
    {
      q: "O recurso de apelacao e dirigido a:",
      opts: [
        "Ao proprio juiz que proferiu a sentenca",
        "Ao tribunal de segunda instancia",
        "Ao STF",
        "Ao STJ",
      ],
      correct: "Ao tribunal de segunda instancia",
      basis: "CPC, Art. 1009",
      explanation: "A apelacao e o recurso contra sentenca, dirigido ao tribunal competente.",
      legTitle: "Codigo de Processo Civil",
      topic: "Recursos",
    },
    {
      q: "A sentenca que extingue o processo sem resolucao de merito e:",
      opts: ["Definitiva", "Terminativa", "Meramente processual", "De merito"],
      correct: "Terminativa",
      basis: "CPC, Art. 485",
      explanation: "Sentenca terminativa extingue o processo sem resolver o merito.",
      legTitle: "Codigo de Processo Civil",
      topic: "Sentenca",
    },
  ],
  "Direito Processual Penal": [
    {
      q: "O inquerito policial e um procedimento:",
      opts: ["Judicial", "Administrativo", "Legislativo", "Arbitral"],
      correct: "Administrativo",
      basis: "CPP, Art. 4-23",
      explanation:
        "O inquerito policial e procedimento administrativo presidido pela autoridade policial.",
      legTitle: "Codigo de Processo Penal",
      topic: "Inquerito Policial",
    },
    {
      q: "A prisao em flagrante requer:",
      opts: ["Mandado judicial", "Situacao de flagrancia", "Ordem do delegado", "Requisicao do MP"],
      correct: "Situacao de flagrancia",
      basis: "CPP, Art. 301-310",
      explanation: "A prisao em flagrante independe de mandado, bastando a situacao de flagrancia.",
      legTitle: "Codigo de Processo Penal",
      topic: "Prisao em Flagrante",
    },
    {
      q: "O habeas corpus no processo penal protege:",
      opts: [
        "O patrimonio do reu",
        "A liberdade de locomocao",
        "O direito a intimidade",
        "O honorario advocaticio",
      ],
      correct: "A liberdade de locomocao",
      basis: "CPP, Art. 647-667",
      explanation: "O HC protege a liberdade de locomocao contra ilegalidade ou abuso de poder.",
      legTitle: "Codigo de Processo Penal",
      topic: "Habeas Corpus",
    },
    {
      q: "A acao penal publica incondicionada e promovida por:",
      opts: ["Pelo ofendido", "Pelo Ministerio Publico", "Pelo delegado", "Pelo juiz"],
      correct: "Pelo Ministerio Publico",
      basis: "CPP, Art. 100",
      explanation: "Na acao penal publica incondicionada, o MP tem titularidade exclusiva.",
      legTitle: "Codigo de Processo Penal",
      topic: "Acao Penal",
    },
    {
      q: "A pronuncia e decisao que:",
      opts: [
        "Absolve o reu",
        "Julga procedente a denuncia",
        "Submete o reu a julgamento pelo Tribunal do Juri",
        "Arquiva o inquerito",
      ],
      correct: "Submete o reu a julgamento pelo Tribunal do Juri",
      basis: "CPP, Art. 413",
      explanation: "A pronuncia submete o acusado a julgamento pelo Juri.",
      legTitle: "Codigo de Processo Penal",
      topic: "Juri",
    },
  ],
  "Direito Administrativo": [
    {
      q: "A administracao publica e pautada pelo principio da:",
      opts: [
        "Discricionariedade absoluta",
        "Legalidade",
        "Autonomia sem limites",
        "Interesse exclusivo do Estado",
      ],
      correct: "Legalidade",
      basis: "CF/88, Art. 37, caput",
      explanation: "O principio da legalidade e basilar na administracao publica.",
      legTitle: "Constituicao Federal",
      topic: "Principios",
    },
    {
      q: "O ato administrativo vinculado e aquele que:",
      opts: [
        "Deixa margem de escolha ao administrador",
        "Nao oferece margem de escolha",
        "Depende de apreciacao subjetiva",
        "E discricionario",
      ],
      correct: "Nao oferece margem de escolha",
      basis: "Lei 4.717/65",
      explanation: "O ato vinculado nao deixa margem de escolha ao administrador.",
      legTitle: "Lei de Acao Popular",
      topic: "Ato Administrativo",
    },
    {
      q: "A licitacao na modalidade pregao e usada para:",
      opts: [
        "Obras de engenharia",
        "Bens e servicos comuns",
        "Alienacao de imoveis",
        "Concessao de servico publico",
      ],
      correct: "Bens e servicos comuns",
      basis: "Lei 8.666/93, Art. 1",
      explanation: "O pregao e utilizado para bens e servicos comuns.",
      legTitle: "Lei de Licitacoes",
      topic: "Licitacao",
    },
    {
      q: "A responsabilidade civil do Estado e:",
      opts: ["Subjetiva", "Objetiva", "Mista", "Inexistente"],
      correct: "Objetiva",
      basis: "CF/88, Art. 37, 6",
      explanation: "A responsabilidade do Estado e objetiva, fundada no risco administrativo.",
      legTitle: "Constituicao Federal",
      topic: "Responsabilidade Civil",
    },
    {
      q: "O poder de policia da administracao consiste em:",
      opts: [
        "Criar servidores publicos",
        "Limitar direitos em beneficio publico",
        "Administrar patrimonio",
        "Julgar litigios",
      ],
      correct: "Limitar direitos em beneficio publico",
      basis: "CTN, Art. 78",
      explanation: "O poder de policia limita ou disciplina direito em razao do interesse publico.",
      legTitle: "CTN",
      topic: "Poder de Policia",
    },
  ],
  "Direito Tributário": [
    {
      q: "O ICMS e imposto de competencia:",
      opts: ["Federal", "Estadual", "Municipal", "Compartilhada"],
      correct: "Estadual",
      basis: "CF/88, Art. 155, II",
      explanation: "O ICMS e de competencia dos Estados e DF.",
      legTitle: "Constituicao Federal",
      topic: "Sistema Tributario",
    },
    {
      q: "O principio da legalidade tributaria estabelece que:",
      opts: [
        "O contribuinte pode criar tributos",
        "So a lei pode instituir tributos",
        "O executivo pode majorar tributos livremente",
        "O judiciario pode criar tributos",
      ],
      correct: "So a lei pode instituir tributos",
      basis: "CF/88, Art. 150, I",
      explanation: "Sem lei formal, nao ha tributo valido.",
      legTitle: "Constituicao Federal",
      topic: "Principios Tributarios",
    },
    {
      q: "O IPTU e imposto de competencia:",
      opts: ["Federal", "Estadual", "Municipal", "Distrital"],
      correct: "Municipal",
      basis: "CF/88, Art. 156, I",
      explanation: "O IPTU e de competencia dos Municipios.",
      legTitle: "Constituicao Federal",
      topic: "Impostos Municipais",
    },
    {
      q: "A isencao tributaria e:",
      opts: [
        "Dispensa de pagamento",
        "Nao-incidencia",
        "Hipoteses de exclusao do credito",
        "Remissao da divida",
      ],
      correct: "Hipoteses de exclusao do credito",
      basis: "CTN, Art. 175",
      explanation: "A isencao e causa de exclusao do credito tributario.",
      legTitle: "CTN",
      topic: "Isencao",
    },
    {
      q: "O lancamento tributario por declaracao e feito com base em:",
      opts: [
        "Apenas dados da fiscalizacao",
        "Declaracao do sujeito passivo",
        "Oficio da autoridade",
        "Acordo entre as partes",
      ],
      correct: "Declaracao do sujeito passivo",
      basis: "CTN, Art. 147",
      explanation: "No lancamento por declaracao, o contribuinte presta informacoes.",
      legTitle: "CTN",
      topic: "Lancamento",
    },
  ],
  "Direito Trabalhista": [
    {
      q: "A CLT foi promulgada em:",
      opts: ["1934", "1943", "1956", "1988"],
      correct: "1943",
      basis: "Decreto-Lei 5.452/43",
      explanation: "A CLT foi promulgada em 01/05/1943.",
      legTitle: "CLT",
      topic: "Noções Gerais",
    },
    {
      q: "A jornada maxima de trabalho e de:",
      opts: ["6 horas", "8 horas", "10 horas", "12 horas"],
      correct: "8 horas",
      basis: "CF/88, Art. 7, XV; CLT, Art. 58",
      explanation: "A jornada maxima e de 8 horas diarias ou 44 semanais.",
      legTitle: "CLT",
      topic: "Jornada de Trabalho",
    },
    {
      q: "O aviso previo proporcional tem no maximo:",
      opts: ["30 dias", "60 dias", "90 dias", "120 dias"],
      correct: "90 dias",
      basis: "CF/88, Art. 7, XXI; Lei 12.506/2011",
      explanation: "O aviso previo proporcional vai ate 90 dias.",
      legTitle: "CLT",
      topic: "Aviso Previo",
    },
    {
      q: "O salario-familia e devido ao trabalhador:",
      opts: [
        "Com qualquer salario",
        "Com salario ate o teto da Previdencia",
        "Apenas urbano",
        "Apenas rural",
      ],
      correct: "Com salario ate o teto da Previdencia",
      basis: "Lei 8.213/91, Art. 77",
      explanation: "O salario-familia e devido ao segurado com remuneracao ate o teto.",
      legTitle: "Lei de Beneficios",
      topic: "Salario-Familia",
    },
    {
      q: "A estabilidade da gestante e de:",
      opts: ["3 meses", "6 meses", "5 meses apos o parto", "Ate 12 meses apos o parto"],
      correct: "5 meses apos o parto",
      basis: "ADCT, Art. 10, II, b",
      explanation:
        "A gestante tem estabilidade desde a confirmacao da gravidez ate 5 meses apos o parto.",
      legTitle: "ADCT",
      topic: "Estabilidade",
    },
  ],
  "Direito Comercial": [
    {
      q: "A sociedade limitada e regida por:",
      opts: ["Apenas pelo Codigo Civil", "Pela Lei das S/A", "Pela CLT", "Pelo Codigo Comercial"],
      correct: "Apenas pelo Codigo Civil",
      basis: "CC/2002, Art. 1052",
      explanation: "A sociedade limitada e regida pelo CC/2002.",
      legTitle: "Codigo Civil",
      topic: "Sociedades",
    },
    {
      q: "O empresario individual tem responsabilidade:",
      opts: ["Limitada ao capital social", "Ilimitada", "Limitada as quotas", "Subsidiaria"],
      correct: "Ilimitada",
      basis: "CC/2002, Art. 966",
      explanation: "O empresario individual responde ilimitadamente com seu patrimonio.",
      legTitle: "Codigo Civil",
      topic: "Empresario",
    },
    {
      q: "A falencia e um processo de:",
      opts: [
        "Recuperacao judicial",
        "Execucao coletiva",
        "Liquidacao amigavel",
        "Reorganizacao societaria",
      ],
      correct: "Execucao coletiva",
      basis: "Lei 11.101/05",
      explanation: "A falencia e processo de execucao coletiva do devedor empresario.",
      legTitle: "Lei de Falencias",
      topic: "Falencia",
    },
    {
      q: "O cheque prescreve em:",
      opts: ["6 meses", "1 ano", "2 anos", "5 anos"],
      correct: "6 meses",
      basis: "Lei 7.357/85, Art. 59",
      explanation: "O cheque prescreve em 6 meses da apresentacao.",
      legTitle: "Lei do Cheque",
      topic: "Titulos de Credito",
    },
    {
      q: "A recuperacao judicial exige:",
      opts: [
        "Apenas pedido do devedor",
        "Requisitos da Lei 11.101/05",
        "Concordancia dos credores",
        "Autorizacao do Banco Central",
      ],
      correct: "Requisitos da Lei 11.101/05",
      basis: "Lei 11.101/05, Art. 48",
      explanation: "A recuperacao judicial exige atendimento dos requisitos legais.",
      legTitle: "Lei de Falencias",
      topic: "Recuperacao Judicial",
    },
  ],
  "Direito Ambiental": [
    {
      q: "O principio do poluidor-pagador estabelece que:",
      opts: [
        "O Estado paga pela poluicao",
        "O poluidor deve reparar o dano",
        "A comunidade arca com os custos",
        "Ninguem responde pela poluicao",
      ],
      correct: "O poluidor deve reparar o dano",
      basis: "Lei 6.938/81, Art. 4, VII",
      explanation: "O poluidor-pagador impoe ao poluidor a obrigacao de reparar ou compensar.",
      legTitle: "PNMA",
      topic: "Principios",
    },
    {
      q: "O licenciamento ambiental e procedimento:",
      opts: [
        "Facultativo",
        "Obrigatorio para atividades potencialmente poluidoras",
        "Apenas para industrias",
        "Apenas para obras publicas",
      ],
      correct: "Obrigatorio para atividades potencialmente poluidoras",
      basis: "Lei 6.938/81, Art. 10",
      explanation:
        "O licenciamento e obrigatorio para atividades efetiva ou potencialmente poluidoras.",
      legTitle: "PNMA",
      topic: "Licenciamento",
    },
    {
      q: "A responsabilidade civil ambiental e:",
      opts: ["Subjetiva", "Objetiva", "Mista", "Inexistente"],
      correct: "Objetiva",
      basis: "CF/88, Art. 225, 3; Lei 6.938/81, Art. 14, 1",
      explanation: "A responsabilidade ambiental e objetiva, fundada no risco.",
      legTitle: "PNMA",
      topic: "Responsabilidade",
    },
    {
      q: "O SNUC cria as categorias de unidades de conservacao:",
      opts: ["2", "4", "6", "12"],
      correct: "12",
      basis: "Lei 9.985/00",
      explanation: "O SNUC cria 12 categorias de unidades de conservacao.",
      legTitle: "SNUC",
      topic: "Unidades de Conservacao",
    },
    {
      q: "A acao civil publica ambiental pode ser proposta por:",
      opts: [
        "Apenas pelo MP",
        "MP, autarquias, fundacoes, sociedade civil",
        "Apenas por ONGs",
        "Apenas pela Fazenda",
      ],
      correct: "MP, autarquias, fundacoes, sociedade civil",
      basis: "Lei 7.347/85, Art. 5",
      explanation: "Diversos legitimados podem propor acao civil publica ambiental.",
      legTitle: "Lei da Acao Civil Publica",
      topic: "Acao Civil Publica",
    },
  ],
  "Ética Profissional": [
    {
      q: "O Estatuto da OAB proibe a advocacia para:",
      opts: [
        "Servidores publicos em geral",
        "Chefes do Poder Executivo",
        "Todos os militares",
        "Professores universitarios",
      ],
      correct: "Chefes do Poder Executivo",
      basis: "Lei 8.906/94, Art. 28",
      explanation: "Os chefes do Poder Executivo nao podem advogar.",
      legTitle: "Estatuto da OAB",
      topic: "Incompatibilidade",
    },
    {
      q: "O sigilo profissional do advogado e:",
      opts: ["Relativo", "Absoluto", "Facultativo", "Parcial"],
      correct: "Absoluto",
      basis: "Lei 8.906/94, Art. 7, XIX",
      explanation: "O sigilo profissional do advogado e absoluto.",
      legTitle: "Estatuto da OAB",
      topic: "Sigilo Profissional",
    },
    {
      q: "A publicidade advocaticia permitida e:",
      opts: ["Comercial", "Informativa e moderada", "Vigorosa e persuasiva", "Proibida"],
      correct: "Informativa e moderada",
      basis: "CED, Art. 28-44",
      explanation: "A publicidade do advogado deve ser informativa e moderada.",
      legTitle: "Codigo de Etica",
      topic: "Publicidade",
    },
    {
      q: "O advogado pode recusar um caso por:",
      opts: [
        "Qualquer motivo",
        "Razoes de foro intimo",
        "Apenas por falta de pagamento",
        "Nunca pode recusar",
      ],
      correct: "Razoes de foro intimo",
      basis: "Lei 8.906/94, Art. 7, IV",
      explanation: "O advogado pode recusar patrocinio por razoes de foro intimo.",
      legTitle: "Estatuto da OAB",
      topic: "Recusa de Patrocinio",
    },
    {
      q: "A lide temeraria e aquela em que o advogado:",
      opts: ["Atua com zelo", "Cria litigio sem fundamento", "Defende com vigor", "Aceita o caso"],
      correct: "Cria litigio sem fundamento",
      basis: "CED, Art. 15",
      explanation: "A lide temeraria e a criacao artificial de litigio.",
      legTitle: "Codigo de Etica",
      topic: "Lide Temeraria",
    },
  ],
};

export type SeedQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  legalBasis: string;
  explanation: string;
  legislationLink: string;
  legislationTitle: string;
  difficulty: string;
  discipline: string;
  topic: string;
  examBoard: string;
  year: number;
  phase: string;
};

const VARIATIONS: ReadonlyArray<{ suffix: string; diff: (typeof DIFFICULTIES)[number] }> = [
  { suffix: "", diff: "medium" },
  { suffix: " - Considere a legislação vigente.", diff: "medium" },
  { suffix: " - De acordo com a jurisprudência predominante.", diff: "hard" },
  { suffix: " - Na forma da lei.", diff: "easy" },
  { suffix: " - Em conformidade com o entendimento sumulado.", diff: "hard" },
  { suffix: " - Segundo a doutrina majoritária.", diff: "medium" },
  { suffix: " - À luz do princípio constitucional.", diff: "hard" },
  { suffix: " - No âmbito do direito positivo.", diff: "medium" },
  { suffix: " - Com base na norma aplicável.", diff: "easy" },
];

function pick<T>(arr: readonly T[], i: number): T {
  const v = arr[i % arr.length];
  if (v === undefined) throw new Error("pick() on empty array");
  return v;
}

// Deterministic: same output every run, so re-seeding is idempotent on the id PK.
export function generateOabQuestions(limit = 500): SeedQuestion[] {
  const out: SeedQuestion[] = [];
  let n = 0;

  for (const discipline of DISCIPLINES) {
    const templates = QUESTION_TEMPLATES[discipline] ?? [];
    for (let ti = 0; ti < templates.length; ti++) {
      const t = templates[ti];
      if (t === undefined) continue;
      for (let vi = 0; vi < VARIATIONS.length; vi++) {
        if (out.length >= limit) return out;
        const v = pick(VARIATIONS, vi);
        out.push({
          id: `q${String(n + 1).padStart(4, "0")}`,
          questionText: t.q + v.suffix,
          options: t.opts,
          correctAnswer: t.correct,
          legalBasis: t.basis,
          explanation: t.explanation,
          legislationLink: "http://www.planalto.gov.br",
          legislationTitle: t.legTitle,
          difficulty: v.diff,
          discipline,
          topic: t.topic,
          examBoard: pick(EXAM_BOARDS, n),
          year: pick(YEARS, n),
          phase: "1st",
        });
        n++;
      }
    }
  }
  return out;
}
