import { DISCIPLINES } from '../types';

export const mockUser = {
  id: 'mock-user-001',
  email: 'demo@lexflow.com',
  name: 'Estudante Demo',
};

export const mockStats = {
  totalAnswered: 247,
  totalCorrect: 168,
  accuracy: 68,
  totalSessions: 18,
  averageTimePerQuestion: 42,
};

export const mockDisciplinePerformance = [
  { discipline: 'Direito Constitucional', accuracy: 78, total_answered: 32, total_correct: 25 },
  { discipline: 'Direito Civil', accuracy: 72, total_answered: 28, total_correct: 20 },
  { discipline: 'Direito Penal', accuracy: 70, total_answered: 25, total_correct: 18 },
  { discipline: 'Direito Administrativo', accuracy: 65, total_answered: 22, total_correct: 14 },
  { discipline: 'Direito Processual Civil', accuracy: 62, total_answered: 20, total_correct: 12 },
  { discipline: 'Direito Tributario', accuracy: 58, total_answered: 18, total_correct: 10 },
  { discipline: 'Direito Processual Penal', accuracy: 55, total_answered: 16, total_correct: 9 },
  { discipline: 'Direito Trabalhista', accuracy: 52, total_answered: 22, total_correct: 11 },
  { discipline: 'Direito Comercial', accuracy: 48, total_answered: 20, total_correct: 10 },
  { discipline: 'Direito Ambiental', accuracy: 45, total_answered: 24, total_correct: 11 },
  { discipline: 'Etica Profissional', accuracy: 40, total_answered: 20, total_correct: 8 },
];

export const mockExamBoardPerformance = [
  { exam_board: 'FGV', accuracy: 65, total_answered: 140 },
  { exam_board: 'CESPE', accuracy: 71, total_answered: 107 },
];

export const mockSessions = [
  { created_at: '2026-04-20T10:00:00', correct_answers: 6, total_questions: 10, discipline: 'Direito Constitucional', difficulty: 'medium' },
  { created_at: '2026-04-22T14:00:00', correct_answers: 7, total_questions: 10, discipline: 'Direito Civil', difficulty: 'easy' },
  { created_at: '2026-04-25T09:00:00', correct_answers: 5, total_questions: 10, discipline: 'Direito Penal', difficulty: 'hard' },
  { created_at: '2026-04-28T11:00:00', correct_answers: 8, total_questions: 10, discipline: 'Direito Administrativo', difficulty: 'medium' },
  { created_at: '2026-05-01T16:00:00', correct_answers: 6, total_questions: 10, discipline: 'Direito Tributario', difficulty: 'medium' },
  { created_at: '2026-05-03T10:00:00', correct_answers: 7, total_questions: 10, discipline: 'Direito Processual Civil', difficulty: 'easy' },
  { created_at: '2026-05-05T13:00:00', correct_answers: 4, total_questions: 10, discipline: 'Direito Ambiental', difficulty: 'hard' },
  { created_at: '2026-05-07T15:00:00', correct_answers: 9, total_questions: 10, discipline: 'Direito Constitucional', difficulty: 'easy' },
  { created_at: '2026-05-09T08:00:00', correct_answers: 5, total_questions: 10, discipline: 'Etica Profissional', difficulty: 'hard' },
  { created_at: '2026-05-11T12:00:00', correct_answers: 7, total_questions: 10, discipline: 'Direito Trabalhista', difficulty: 'medium' },
  { created_at: '2026-05-13T09:30:00', correct_answers: 8, total_questions: 10, discipline: 'Direito Civil', difficulty: 'medium' },
  { created_at: '2026-05-14T14:00:00', correct_answers: 6, total_questions: 10, discipline: 'Direito Comercial', difficulty: 'medium' },
];

export const mockGoals = [
  { id: 'g1', discipline: 'Direito Constitucional', target_accuracy: 80, current_accuracy: 78, progress: 98 },
  { id: 'g2', discipline: 'Direito Civil', target_accuracy: 75, current_accuracy: 72, progress: 96 },
  { id: 'g3', discipline: 'Direito Penal', target_accuracy: 70, current_accuracy: 70, progress: 100 },
  { id: 'g4', discipline: 'Direito Ambiental', target_accuracy: 60, current_accuracy: 45, progress: 75 },
  { id: 'g5', discipline: 'Etica Profissional', target_accuracy: 65, current_accuracy: 40, progress: 62 },
];

export const mockQuestions = generateMockQuestions();

function generateMockQuestions() {
  const questions = [];
  let id = 1;

  const templates: Record<string, Array<{
    q: string;
    opts: string[];
    correct: string;
    basis: string;
    explanation: string;
    legTitle: string;
    topic: string;
  }>> = {
    'Direito Constitucional': [
      { q: 'A Constituicao Federal de 1988 e considerada:', opts: ['Flexivel', 'Rigida', 'Semirrigida', 'Inflexivel'], correct: 'Rigida', basis: 'CF/88, Art. 60', explanation: 'A CF/88 e rigida pois exige processo legislativo especial para emendas.', legTitle: 'Constituicao Federal', topic: 'Caracteristicas da CF/88' },
      { q: 'Qual e um fundamento da Republica Federativa do Brasil?', opts: ['Livre iniciativa', 'Dignidade da pessoa humana', 'Desenvolvimento nacional', 'Pluralismo politico'], correct: 'Dignidade da pessoa humana', basis: 'CF/88, Art. 1, III', explanation: 'A dignidade da pessoa humana e fundamento da Republica.', legTitle: 'Constituicao Federal', topic: 'Fundamentos' },
      { q: 'O direito a vida e classificado como direito:', opts: ['Social', 'Politico', 'Individual', 'Difuso'], correct: 'Individual', basis: 'CF/88, Art. 5, caput', explanation: 'O direito a vida e um direito fundamental individual.', legTitle: 'Constituicao Federal', topic: 'Direitos Fundamentais' },
      { q: 'O habeas corpus e utilizado para proteger:', opts: ['O patrimonio', 'A liberdade de locomocao', 'O honorario', 'A intimidade'], correct: 'A liberdade de locomocao', basis: 'CF/88, Art. 5, LXVIII', explanation: 'O habeas corpus protege a liberdade de locomocao.', legTitle: 'Constituicao Federal', topic: 'Remedios Constitucionais' },
      { q: 'O mandado de seguranca protege direito liquido e certo nao amparado por:', opts: ['Habeas corpus ou habeas data', 'Acao popular ou acao civil publica', 'Acao rescisoria ou revisao criminal', 'Recurso especial ou extraordinario'], correct: 'Habeas corpus ou habeas data', basis: 'CF/88, Art. 5, LXIX', explanation: 'O MS protege direito liquido e certo nao amparado por HC ou HD.', legTitle: 'Constituicao Federal', topic: 'Remedios Constitucionais' },
      { q: 'A clausula de barreira visa:', opts: ['Limitar o numero de partidos', 'Garantir representatividade minima no Legislativo', 'Impedir a criacao de novos partidos', 'Aumentar o numero de parlamentares'], correct: 'Garantir representatividade minima no Legislativo', basis: 'CF/88, Art. 13', explanation: 'A clausula de barreira exige desempenho eleitoral minimo para acesso a recursos e tempo de TV.', legTitle: 'Constituicao Federal', topic: 'Partidos Politicos' },
      { q: 'O principio da reserva legal esta previsto no:', opts: ['Art. 5, II da CF/88', 'Art. 5, XXXIX da CF/88', 'Art. 5, I da CF/88', 'Art. 5, XLI da CF/88'], correct: 'Art. 5, XXXIX da CF/88', basis: 'CF/88, Art. 5, XXXIX', explanation: 'Nao ha crime sem lei anterior que o defina, nem pena sem previa cominacao legal.', legTitle: 'Constituicao Federal', topic: 'Principios Fundamentais' },
      { q: 'O federalismo brasileiro e caracterizado como:', opts: ['De cooperacao', 'Dual', 'Simetrico', 'De segregacao'], correct: 'De cooperacao', basis: 'CF/88, Arts. 1-18', explanation: 'O federalismo brasileiro e de cooperacao, com reparticao de competencias.', legTitle: 'Constituicao Federal', topic: 'Organizacao do Estado' },
    ],
    'Direito Civil': [
      { q: 'A capacidade civil e classificada em:', opts: ['Capacidade de direito e de fato', 'Capacidade ativa e passiva', 'Capacidade absoluta e relativa', 'Capacidade civil e comercial'], correct: 'Capacidade de direito e de fato', basis: 'CC/2002, Art. 1-6', explanation: 'Capacidade de direito (titularidade) e de fato (exercicio).', legTitle: 'Codigo Civil', topic: 'Pessoa e Capacidade' },
      { q: 'O negocio juridico nulo pode ser:', opts: ['Convalidado a qualquer tempo', 'Confirmado tacitamente', 'Declarado nulo de pleno direito', 'Ratificado pelas partes'], correct: 'Declarado nulo de pleno direito', basis: 'CC/2002, Art. 166', explanation: 'O negocio nulo nao produz efeitos e nao pode ser convalidado.', legTitle: 'Codigo Civil', topic: 'Negocio Juridico' },
      { q: 'A prescricao extintiva ocorre quando:', opts: ['O credor renuncia ao credito', 'O devedor paga a divida', 'O credor nao exerce o direito no prazo legal', 'As partes acordam a extincao'], correct: 'O credor nao exerce o direito no prazo legal', basis: 'CC/2002, Art. 189', explanation: 'A prescricao extintiva ocorre pela inercia do titular no prazo legal.', legTitle: 'Codigo Civil', topic: 'Prescricao' },
      { q: 'A posse direta e aquela exercida por:', opts: ['O proprietario', 'O possuidor indireto', 'Quem tem a coisa em virtude de direito real', 'O herdeiro'], correct: 'Quem tem a coisa em virtude de direito real', basis: 'CC/2002, Art. 1197', explanation: 'A posse direta e exercida por detentor de direito real sobre a coisa.', legTitle: 'Codigo Civil', topic: 'Posse' },
      { q: 'O contrato de compra e venda e:', opts: ['Real', 'Solene', 'Consensual', 'Gratuito'], correct: 'Consensual', basis: 'CC/2002, Art. 481', explanation: 'A compra e venda se perfaz com o consentimento, sendo consensual.', legTitle: 'Codigo Civil', topic: 'Contratos' },
      { q: 'A responsabilidade civil objetiva exige:', opts: ['Dolo do agente', 'Culpa do agente', 'Nexo causal e dano', 'Apenas dano'], correct: 'Nexo causal e dano', basis: 'CC/2002, Art. 927, paragrafo unico', explanation: 'Na responsabilidade objetiva, basta o nexo causal e o dano.', legTitle: 'Codigo Civil', topic: 'Responsabilidade Civil' },
      { q: 'O usucapiao extraordinario exige posse de:', opts: ['5 anos', '10 anos', '15 anos', '20 anos'], correct: '15 anos', basis: 'CC/2002, Art. 1238', explanation: 'O usucapiao extraordinario exige posse mansa e pacifica por 15 anos.', legTitle: 'Codigo Civil', topic: 'Usucapiao' },
      { q: 'A tutela e o instituto pelo qual:', opts: ['O pai exerce o poder familiar', 'O juiz nomeia tutor para menor', 'O curador administra bens', 'O inventariante partilha bens'], correct: 'O juiz nomeia tutor para menor', basis: 'CC/2002, Art. 1728', explanation: 'A tutela e o instituto de protecao a menor, nomeada pelo juiz.', legTitle: 'Codigo Civil', topic: 'Direito de Familia' },
    ],
    'Direito Penal': [
      { q: 'O principio da legalidade penal estabelece:', opts: ['Que so existe crime se houver dolo', 'Que nao ha crime sem lei anterior que o defina', 'Que o juiz pode criar crimes', 'Que qualquer ato e crime'], correct: 'Que nao ha crime sem lei anterior que o defina', basis: 'CF/88, Art. 5, XXXIX; CP, Art. 1', explanation: 'Nullum crimen sine lege: nao ha crime sem lei anterior.', legTitle: 'Codigo Penal', topic: 'Principios' },
      { q: 'O homicidio qualificado tem pena de:', opts: ['6 meses a 1 ano', '1 a 3 anos', '12 a 30 anos', '30 a 40 anos'], correct: '12 a 30 anos', basis: 'CP, Art. 121, 2', explanation: 'O homicidio qualificado tem pena de 12 a 30 anos.', legTitle: 'Codigo Penal', topic: 'Crimes Contra a Vida' },
      { q: 'A legitima defesa exige:', opts: ['Agressao injusta, atual ou iminente', 'Agressao futura e hipotetica', 'Agressao passada e consumada', 'Agressao justa e proporcional'], correct: 'Agressao injusta, atual ou iminente', basis: 'CP, Art. 25', explanation: 'A legitima defesa pressupoe agressao injusta, atual ou iminente.', legTitle: 'Codigo Penal', topic: 'Excludentes de Ilicitude' },
      { q: 'O crime tentado ocorre quando:', opts: ['O agente desiste voluntariamente', 'O crime nao se consuma por circunstancias alheias a vontade', 'O agente impede o resultado', 'O agente se arrepende apos o fato'], correct: 'O crime nao se consuma por circunstancias alheias a vontade', basis: 'CP, Art. 14, II', explanation: 'A tentativa ocorre quando o crime nao se consuma por razoes externas.', legTitle: 'Codigo Penal', topic: 'Tentativa' },
      { q: 'O dolo direto e caracterizado quando o agente:', opts: ['Preve o resultado como possivel', 'Quer o resultado como fim', 'Nao preve o resultado', 'Aceita o risco de produzir resultado'], correct: 'Quer o resultado como fim', basis: 'CP, Art. 18, I', explanation: 'Dolo direto: o agente quer o resultado como fim de sua conduta.', legTitle: 'Codigo Penal', topic: 'Dolo e Culpa' },
      { q: 'A imputabilidade penal e a capacidade de:', opts: ['Entender e querer', 'Ser processado', 'Pagar indenizacao', 'Ser julgado'], correct: 'Entender e querer', basis: 'CP, Art. 26', explanation: 'Imputavel e quem tem capacidade de entender o carater ilicito do fato e determinar-se de acordo com esse entendimento.', legTitle: 'Codigo Penal', topic: 'Imputabilidade' },
      { q: 'O crime de furto diferencia-se de roubo pela:', opts: ['Gravidade da pena', 'Ausencia de violencia ou grave ameaca', 'Natureza do bem subtraido', 'Condicao social do agente'], correct: 'Ausencia de violencia ou grave ameaca', basis: 'CP, Art. 155 vs 157', explanation: 'Furto e sem violencia; roubo emprega violencia ou grave ameaca.', legTitle: 'Codigo Penal', topic: 'Crimes Contra o Patrimonio' },
      { q: 'A prescricao penal retroativa considera:', opts: ['A pena em abstrato', 'A pena concretamente aplicada', 'O tempo de prisao', 'A data do fato'], correct: 'A pena concretamente aplicada', basis: 'CP, Art. 110', explanation: 'A prescricao retroativa considera a pena concretamente fixada na sentenca.', legTitle: 'Codigo Penal', topic: 'Prescricao' },
    ],
    'Direito Processual Civil': [
      { q: 'O CPC atual e de qual ano?', opts: ['1973', '1988', '2015', '2020'], correct: '2015', basis: 'Lei 13.105/2015', explanation: 'O CPC/2015 entrou em vigor em 18/03/2016.', legTitle: 'Codigo de Processo Civil', topic: 'Nocoes Gerais' },
      { q: 'A competencia territorial e definida por:', opts: ['O local onde reside o juiz', 'O local do tribunal', 'O domicilio do reu', 'A vontade das partes'], correct: 'O domicilio do reu', basis: 'CPC, Art. 46-52', explanation: 'Regra geral: foro do domicilio do reu.', legTitle: 'Codigo de Processo Civil', topic: 'Competencia' },
      { q: 'A tutela provisoria de urgencia antecipada requer:', opts: ['Prova inequivoca e perigo de dano', 'Apenas probabilidade do direito', 'Certeza absoluta do direito', 'Concordancia da parte contraria'], correct: 'Prova inequivoca e perigo de dano', basis: 'CPC, Art. 303', explanation: 'A antecipacao requer prova inequivoca e perigo de dano ou risco ao resultado util.', legTitle: 'Codigo de Processo Civil', topic: 'Tutela Provisoria' },
      { q: 'O recurso de apelacao e dirigido a:', opts: ['Ao proprio juiz que proferiu a sentenca', 'Ao tribunal de segunda instancia', 'Ao STF', 'Ao STJ'], correct: 'Ao tribunal de segunda instancia', basis: 'CPC, Art. 1009', explanation: 'A apelacao e o recurso contra sentenca, dirigido ao tribunal competente.', legTitle: 'Codigo de Processo Civil', topic: 'Recursos' },
      { q: 'A sentenca que extingue o processo sem resolucao de merito e:', opts: ['Definitiva', 'Terminativa', 'Meramente processual', 'De merito'], correct: 'Terminativa', basis: 'CPC, Art. 485', explanation: 'Sentenca terminativa extingue o processo sem resolver o merito.', legTitle: 'Codigo de Processo Civil', topic: 'Sentenca' },
      { q: 'A audiencia de conciliacao no CPC/2015:', opts: ['E obrigatoria', 'Depende de convencao das partes', 'E facultativa para o juiz', 'Foi extinta'], correct: 'Depende de convencao das partes', basis: 'CPC, Art. 319, VII', explanation: 'A audiencia de conciliacao so ocorre se nao houver opcao das partes.', legTitle: 'Codigo de Processo Civil', topic: 'Procedimento Comum' },
      { q: 'O incidente de resolucao de demandas repetitivas e instrumento de:', opts: ['Jurisdicao voluntaria', 'Processamento de demandas em massa', 'Execucao forçada', 'Recurso especial'], correct: 'Processamento de demandas em massa', basis: 'CPC, Art. 976-987', explanation: 'O IRDR uniformiza interpretacao de questoes repetitivas.', legTitle: 'Codigo de Processo Civil', topic: 'Processos Repetitivos' },
      { q: 'A reconvencao no CPC/2015 pode ser proposta:', opts: ['Apenas em procedimento comum', 'Em qualquer procedimento', 'Apenas em execucao', 'Nunca mais existe'], correct: 'Em qualquer procedimento', basis: 'CPC, Art. 343', explanation: 'O CPC/2015 ampliou o cabimento da reconvencao.', legTitle: 'Codigo de Processo Civil', topic: 'Defesa do Reu' },
    ],
    'Direito Processual Penal': [
      { q: 'O inquerito policial e um procedimento:', opts: ['Judicial', 'Administrativo', 'Legislativo', 'Arbitral'], correct: 'Administrativo', basis: 'CPP, Art. 4-23', explanation: 'O inquerito policial e procedimento administrativo presidido pela autoridade policial.', legTitle: 'Codigo de Processo Penal', topic: 'Inquerito Policial' },
      { q: 'A prisao em flagrante requer:', opts: ['Mandado judicial', 'Situacao de flagrancia', 'Ordem do delegado', 'Requisicao do MP'], correct: 'Situacao de flagrancia', basis: 'CPP, Art. 301-310', explanation: 'A prisao em flagrante independe de mandado, bastando a situacao de flagrancia.', legTitle: 'Codigo de Processo Penal', topic: 'Prisao em Flagrante' },
      { q: 'O habeas corpus no processo penal protege:', opts: ['O patrimonio do reu', 'A liberdade de locomocao', 'O direito a intimidade', 'O honorario advocaticio'], correct: 'A liberdade de locomocao', basis: 'CPP, Art. 647-667', explanation: 'O HC protege a liberdade de locomocao contra ilegalidade ou abuso de poder.', legTitle: 'Codigo de Processo Penal', topic: 'Habeas Corpus' },
      { q: 'A acao penal publica incondicionada e promovida por:', opts: ['Pelo ofendido', 'Pelo Ministerio Publico', 'Pelo delegado', 'Pelo juiz'], correct: 'Pelo Ministerio Publico', basis: 'CPP, Art. 100', explanation: 'Na acao penal publica incondicionada, o MP tem titularidade exclusiva.', legTitle: 'Codigo de Processo Penal', topic: 'Acao Penal' },
      { q: 'A pronuncia e decisao que:', opts: ['Absolve o reu', 'Julga procedente a denuncia', 'Submete o reu a julgamento pelo Tribunal do Juri', 'Arquiva o inquerito'], correct: 'Submete o reu a julgamento pelo Tribunal do Juri', basis: 'CPP, Art. 413', explanation: 'A pronuncia submete o acusado a julgamento pelo Juri.', legTitle: 'Codigo de Processo Penal', topic: 'Juri' },
      { q: 'A nulidade absoluta no processo penal:', opts: ['Pode ser convalidada', 'Nao pode ser convalidada', 'Depende do juiz', 'E relativa'], correct: 'Nao pode ser convalidada', basis: 'CPP, Art. 564', explanation: 'Nulidades absolutas nao podem ser convalidadas e devem ser declaradas de oficio.', legTitle: 'Codigo de Processo Penal', topic: 'Nulidades' },
      { q: 'O recurso em sentido estrito e cabivel contra:', opts: ['Sentenca condenatoria', 'Decisoes enumeradas no Art. 581 do CPP', 'Acordao de apelacao', 'Despacho de mero expediente'], correct: 'Decisoes enumeradas no Art. 581 do CPP', basis: 'CPP, Art. 581', explanation: 'O RESE e cabivel contra decisoes taxativamente previstas no Art. 581.', legTitle: 'Codigo de Processo Penal', topic: 'Recursos' },
      { q: 'A liberdade provisoria e:', opts: ['Sempre com fianca', 'Pode ser com ou sem fianca', 'Apenas sem fianca', 'Inconstitucional'], correct: 'Pode ser com ou sem fianca', basis: 'CPP, Art. 321-350', explanation: 'A liberdade provisoria pode ser concedida com ou sem fianca.', legTitle: 'Codigo de Processo Penal', topic: 'Liberdade Provisoria' },
    ],
    'Direito Administrativo': [
      { q: 'A administracao publica e pautada pelo principio da:', opts: ['Discricionariedade absoluta', 'Legalidade', 'Autonomia sem limites', 'Interesse exclusivo do Estado'], correct: 'Legalidade', basis: 'CF/88, Art. 37, caput', explanation: 'O principio da legalidade e basilar na administracao publica.', legTitle: 'Constituicao Federal', topic: 'Principios' },
      { q: 'O ato administrativo vinculado e aquele que:', opts: ['Deixa margem de escolha ao administrador', 'Nao oferece margem de escolha', 'Depende de apreciacao subjetiva', 'E discricionario'], correct: 'Nao oferece margem de escolha', basis: 'Lei 4.717/65', explanation: 'O ato vinculado nao deixa margem de escolha ao administrador.', legTitle: 'Lei de Acao Popular', topic: 'Ato Administrativo' },
      { q: 'A licitacao na modalidade pregao e usada para:', opts: ['Obras de engenharia', 'Bens e servicos comuns', 'Alienacao de imoveis', 'Concessao de servico publico'], correct: 'Bens e servicos comuns', basis: 'Lei 8.666/93, Art. 1', explanation: 'O pregao e utilizado para bens e servicos comuns.', legTitle: 'Lei de Licitacoes', topic: 'Licitacao' },
      { q: 'A responsabilidade civil do Estado e:', opts: ['Subjetiva', 'Objetiva', 'Mista', 'Inexistente'], correct: 'Objetiva', basis: 'CF/88, Art. 37, 6', explanation: 'A responsabilidade do Estado e objetiva, fundada no risco administrativo.', legTitle: 'Constituicao Federal', topic: 'Responsabilidade Civil' },
      { q: 'O poder de policia da administracao consiste em:', opts: ['Criar servidores publicos', 'Limitar direitos em beneficio publico', 'Administrar patrimonio', 'Julgar litigios'], correct: 'Limitar direitos em beneficio publico', basis: 'CTN, Art. 78', explanation: 'O poder de policia limita ou disciplina direito em razao do interesse publico.', legTitle: 'CTN', topic: 'Poder de Policia' },
      { q: 'A autarquia e pessoa juridica de direito:', opts: ['Privado', 'Publico', 'Misto', 'Internacional'], correct: 'Publico', basis: 'DL 200/67, Art. 5, I', explanation: 'Autarquias sao pessoas juridicas de direito publico integrantes da Administracao Indireta.', legTitle: 'Decreto-Lei 200/67', topic: 'Organizacao Administrativa' },
      { q: 'O servico publico delegado por concessao exige:', opts: ['Apenas contrato administrativo', 'Licitacao previa e lei autorizadora', 'Apenas autorizacao do prefeito', 'Concordancia dos usuarios'], correct: 'Licitacao previa e lei autorizadora', basis: 'Lei 8.987/95, Art. 2', explanation: 'A concessao de servico publico exige licitacao previa na modalidade concorrencia.', legTitle: 'Lei de Concessoes', topic: 'Servicos Publicos' },
      { q: 'A improbidade administrativa pode gerar:', opts: ['Apenas advertencia', 'Suspensao de direitos politicos, multa e ressarcimento', 'Apenas demissao', 'Apenas multa'], correct: 'Suspensao de direitos politicos, multa e ressarcimento', basis: 'Lei 8.429/92, Art. 8-12', explanation: 'A Lei de Improbidade prevê sancoes variadas conforme a gravidade do ato.', legTitle: 'Lei de Improbidade', topic: 'Improbidade Administrativa' },
    ],
    'Direito Tributario': [
      { q: 'O ICMS e imposto de competencia:', opts: ['Federal', 'Estadual', 'Municipal', 'Compartilhada'], correct: 'Estadual', basis: 'CF/88, Art. 155, II', explanation: 'O ICMS e de competencia dos Estados e DF.', legTitle: 'Constituicao Federal', topic: 'Sistema Tributario' },
      { q: 'O principio da legalidade tributaria estabelece que:', opts: ['O contribuinte pode criar tributos', 'So a lei pode instituir tributos', 'O executivo pode majorar tributos livremente', 'O judiciario pode criar tributos'], correct: 'So a lei pode instituir tributos', basis: 'CF/88, Art. 150, I', explanation: 'Sem lei formal, nao ha tributo valido.', legTitle: 'Constituicao Federal', topic: 'Principios Tributarios' },
      { q: 'O IPTU e imposto de competencia:', opts: ['Federal', 'Estadual', 'Municipal', 'Distrital'], correct: 'Municipal', basis: 'CF/88, Art. 156, I', explanation: 'O IPTU e de competencia dos Municipios.', legTitle: 'Constituicao Federal', topic: 'Impostos Municipais' },
      { q: 'A isencao tributaria e:', opts: ['Dispensa de pagamento', 'Nao-incidencia', 'Hipoteses de exclusao do credito', 'Remissao da divida'], correct: 'Hipoteses de exclusao do credito', basis: 'CTN, Art. 175', explanation: 'A isencao e causa de exclusao do credito tributario.', legTitle: 'CTN', topic: 'Isencao' },
      { q: 'O lancamento tributario por declaracao e feito com base em:', opts: ['Apenas dados da fiscalizacao', 'Declaracao do sujeito passivo', 'Oficio da autoridade', 'Acordo entre as partes'], correct: 'Declaracao do sujeito passivo', basis: 'CTN, Art. 147', explanation: 'No lancamento por declaracao, o contribuinte presta informacoes.', legTitle: 'CTN', topic: 'Lancamento' },
      { q: 'O principio da anterioridade tributaria veda a cobranca de tributos:', opts: ['No mesmo exercicio financeiro da publicacao da lei', 'Apos 90 dias da publicacao', 'No ano seguinte', 'Sempre'], correct: 'No mesmo exercicio financeiro da publicacao da lei', basis: 'CF/88, Art. 150, III, b', explanation: 'A anterioridade anual veda cobranca no mesmo exercicio financeiro.', legTitle: 'Constituicao Federal', topic: 'Principios Tributarios' },
      { q: 'A obrigacao tributaria principal tem por objeto:', opts: ['Declaracao de imposto de renda', 'O pagamento de tributo', 'Emitir nota fiscal', 'Fazer declaracao'], correct: 'O pagamento de tributo', basis: 'CTN, Art. 113, 1', explanation: 'A obrigacao principal e a de pagar tributo.', legTitle: 'CTN', topic: 'Obrigacao Tributaria' },
      { q: 'O imposto de renda e de competencia:', opts: ['Estadual', 'Municipal', 'Federal', 'Compartilhada'], correct: 'Federal', basis: 'CF/88, Art. 153, III', explanation: 'O IR e de competencia da Uniao.', legTitle: 'Constituicao Federal', topic: 'Impostos Federais' },
    ],
    'Direito Trabalhista': [
      { q: 'A CLT foi promulgada em:', opts: ['1934', '1943', '1956', '1988'], correct: '1943', basis: 'Decreto-Lei 5.452/43', explanation: 'A CLT foi promulgada em 01/05/1943.', legTitle: 'CLT', topic: 'Nocoes Gerais' },
      { q: 'A jornada maxima de trabalho e de:', opts: ['6 horas', '8 horas', '10 horas', '12 horas'], correct: '8 horas', basis: 'CF/88, Art. 7, XV; CLT, Art. 58', explanation: 'A jornada maxima e de 8 horas diarias ou 44 semanais.', legTitle: 'CLT', topic: 'Jornada de Trabalho' },
      { q: 'O aviso previo proporcional tem no maximo:', opts: ['30 dias', '60 dias', '90 dias', '120 dias'], correct: '90 dias', basis: 'CF/88, Art. 7, XXI; Lei 12.506/2011', explanation: 'O aviso previo proporcional vai ate 90 dias.', legTitle: 'CLT', topic: 'Aviso Previo' },
      { q: 'O salario-familia e devido ao trabalhador:', opts: ['Com qualquer salario', 'Com salario ate o teto da Previdencia', 'Apenas urbano', 'Apenas rural'], correct: 'Com salario ate o teto da Previdencia', basis: 'Lei 8.213/91, Art. 77', explanation: 'O salario-familia e devido ao segurado com remuneracao ate o teto.', legTitle: 'Lei de Beneficios', topic: 'Salario-Familia' },
      { q: 'A estabilidade da gestante e de:', opts: ['3 meses', '6 meses', '5 meses apos o parto', 'Ate 12 meses apos o parto'], correct: '5 meses apos o parto', basis: 'ADCT, Art. 10, II, b', explanation: 'A gestante tem estabilidade desde a confirmacao da gravidez ate 5 meses apos o parto.', legTitle: 'ADCT', topic: 'Estabilidade' },
      { q: 'A reforma trabalhista (Lei 13.467/2017):', opts: ['Extiguiu a CLT', 'Alterou diversos dispositivos da CLT', 'Criou a Justica do Trabalho', 'Revogou a consolidacao'], correct: 'Alterou diversos dispositivos da CLT', basis: 'Lei 13.467/2017', explanation: 'A reforma trabalhista alterou mais de 100 artigos da CLT.', legTitle: 'CLT', topic: 'Reforma Trabalhista' },
      { q: 'O contrato de experiencia tem duracao maxima de:', opts: ['30 dias', '45 dias', '60 dias', '90 dias'], correct: '90 dias', basis: 'CLT, Art. 445, paragrafo unico', explanation: 'O contrato de experiencia pode ter ate 90 dias.', legTitle: 'CLT', topic: 'Contrato de Trabalho' },
      { q: 'A justa causa para rescisao do contrato de trabalho:', opts: ['Pode ser aplicada sem procedimento', 'Exige procedimento e comprovacao', 'E sempre decidida pelo juiz', 'Nao existe mais'], correct: 'Exige procedimento e comprovacao', basis: 'CLT, Art. 482', explanation: 'A justa causa exige comprovacao dos motivos e observancia do principio da proporcionalidade.', legTitle: 'CLT', topic: 'Justa Causa' },
    ],
    'Direito Comercial': [
      { q: 'A sociedade limitada e regida por:', opts: ['Apenas pelo Codigo Civil', 'Pela Lei das S/A', 'Pela CLT', 'Pelo Codigo Comercial'], correct: 'Apenas pelo Codigo Civil', basis: 'CC/2002, Art. 1052', explanation: 'A sociedade limitada e regida pelo CC/2002.', legTitle: 'Codigo Civil', topic: 'Sociedades' },
      { q: 'O empresario individual tem responsabilidade:', opts: ['Limitada ao capital social', 'Ilimitada', 'Limitada as quotas', 'Subsidiaria'], correct: 'Ilimitada', basis: 'CC/2002, Art. 966', explanation: 'O empresario individual responde ilimitadamente com seu patrimonio.', legTitle: 'Codigo Civil', topic: 'Empresario' },
      { q: 'A falencia e um processo de:', opts: ['Recuperacao judicial', 'Execucao coletiva', 'Liquidacao amigavel', 'Reorganizacao societaria'], correct: 'Execucao coletiva', basis: 'Lei 11.101/05', explanation: 'A falencia e processo de execucao coletiva do devedor empresario.', legTitle: 'Lei de Falencias', topic: 'Falencia' },
      { q: 'O cheque prescreve em:', opts: ['6 meses', '1 ano', '2 anos', '5 anos'], correct: '6 meses', basis: 'Lei 7.357/85, Art. 59', explanation: 'O cheque prescreve em 6 meses da apresentacao.', legTitle: 'Lei do Cheque', topic: 'Titulos de Credito' },
      { q: 'A recuperacao judicial exige:', opts: ['Apenas pedido do devedor', 'Requisitos da Lei 11.101/05', 'Concordancia dos credores', 'Autorizacao do Banco Central'], correct: 'Requisitos da Lei 11.101/05', basis: 'Lei 11.101/05, Art. 48', explanation: 'A recuperacao judicial exige atendimento dos requisitos legais.', legTitle: 'Lei de Falencias', topic: 'Recuperacao Judicial' },
      { q: 'A MEI (Microempreendedor Individual) e:', opts: ['Uma sociedade', 'Uma forma de empresario individual', 'Uma cooperativa', 'Uma S/A'], correct: 'Uma forma de empresario individual', basis: 'LC 123/06', explanation: 'O MEI e uma forma simplificada de empresario individual.', legTitle: 'Estatuto da MEI', topic: 'Microempresa' },
      { q: 'O contrato de franquia exige:', opts: ['Registro no INPI', 'Circular de oferta de franquia previa', 'Apenas contrato assinado', 'Autorizacao do Ministerio'], correct: 'Circular de oferta de franquia previa', basis: 'Lei 13.966/19', explanation: 'A Lei de Franquias exige a entrega previa da circular de oferta.', legTitle: 'Lei de Franquias', topic: 'Franquia' },
      { q: 'A nota promissoria e titulo de credito:', opts: ['De modelo livre', 'De modelo vinculado', 'Nao cambiario', 'De ordem de pagamento'], correct: 'De modelo vinculado', basis: 'DL 167/67', explanation: 'A nota promissoria segue modelo vinculado, com requisitos formais.', legTitle: 'Legislacao Cambiaria', topic: 'Titulos de Credito' },
    ],
    'Direito Ambiental': [
      { q: 'O principio do poluidor-pagador estabelece que:', opts: ['O Estado paga pela poluicao', 'O poluidor deve reparar o dano', 'A comunidade arca com os custos', 'Ninguem responde pela poluicao'], correct: 'O poluidor deve reparar o dano', basis: 'Lei 6.938/81, Art. 4, VII', explanation: 'O poluidor-pagador impoe ao poluidor a obrigacao de reparar ou compensar.', legTitle: 'PNMA', topic: 'Principios' },
      { q: 'O licenciamento ambiental e procedimento:', opts: ['Facultativo', 'Obrigatorio para atividades potencialmente poluidoras', 'Apenas para industrias', 'Apenas para obras publicas'], correct: 'Obrigatorio para atividades potencialmente poluidoras', basis: 'Lei 6.938/81, Art. 10', explanation: 'O licenciamento e obrigatorio para atividades efetiva ou potencialmente poluidoras.', legTitle: 'PNMA', topic: 'Licenciamento' },
      { q: 'A responsabilidade civil ambiental e:', opts: ['Subjetiva', 'Objetiva', 'Mista', 'Inexistente'], correct: 'Objetiva', basis: 'CF/88, Art. 225, 3; Lei 6.938/81, Art. 14, 1', explanation: 'A responsabilidade ambiental e objetiva, fundada no risco.', legTitle: 'PNMA', topic: 'Responsabilidade' },
      { q: 'O SNUC cria as categorias de unidades de conservacao:', opts: ['2', '4', '6', '12'], correct: '12', basis: 'Lei 9.985/00', explanation: 'O SNUC cria 12 categorias de unidades de conservacao.', legTitle: 'SNUC', topic: 'Unidades de Conservacao' },
      { q: 'A acao civil publica ambiental pode ser proposta por:', opts: ['Apenas pelo MP', 'MP, autarquias, fundacoes, sociedade civil', 'Apenas por ONGs', 'Apenas pela Fazenda'], correct: 'MP, autarquias, fundacoes, sociedade civil', basis: 'Lei 7.347/85, Art. 5', explanation: 'Diversos legitimados podem propor acao civil publica ambiental.', legTitle: 'Lei da Acao Civil Publica', topic: 'Acao Civil Publica' },
      { q: 'O dano ambiental e de natureza:', opts: ['Apenas patrimonial', 'Apenas moral', 'Patrimonial, moral e extrapatrimonial', 'Inexistente'], correct: 'Patrimonial, moral e extrapatrimonial', basis: 'CF/88, Art. 225', explanation: 'O dano ambiental pode ser patrimonial, moral e extrapatrimonial.', legTitle: 'Constituicao Federal', topic: 'Dano Ambiental' },
      { q: 'O principio da prevencao ambiental determina:', opts: ['Reparar o dano', 'Evitar o dano antes que ocorra', 'Compensar financeiramente', 'Ignorar riscos'], correct: 'Evitar o dano antes que ocorra', basis: 'Declaracao do Rio, Principio 15', explanation: 'O principio da prevencao exige medidas para evitar danos ambientais.', legTitle: 'Direito Internacional', topic: 'Principios' },
      { q: 'A APA (Area de Protecao Ambiental) e uma unidade de conservacao:', opts: ['De protecao integral', 'De uso sustentavel', 'Mista', 'Nao e UC'], correct: 'De uso sustentavel', basis: 'Lei 9.985/00, Art. 15', explanation: 'A APA e categoria de uso sustentavel, permitindo ocupacao humana.', legTitle: 'SNUC', topic: 'Unidades de Conservacao' },
    ],
    'Etica Profissional': [
      { q: 'O Estatuto da OAB proibe a advocacia para:', opts: ['Servidores publicos em geral', 'Chefes do Poder Executivo', 'Todos os militares', 'Professores universitarios'], correct: 'Chefes do Poder Executivo', basis: 'Lei 8.906/94, Art. 28', explanation: 'Os chefes do Poder Executivo nao podem advogar.', legTitle: 'Estatuto da OAB', topic: 'Incompatibilidade' },
      { q: 'O sigilo profissional do advogado e:', opts: ['Relativo', 'Absoluto', 'Facultativo', 'Parcial'], correct: 'Absoluto', basis: 'Lei 8.906/94, Art. 7, XIX', explanation: 'O sigilo profissional do advogado e absoluto.', legTitle: 'Estatuto da OAB', topic: 'Sigilo Profissional' },
      { q: 'A publicidade advocaticia permitida e:', opts: ['Comercial', 'Informativa e moderada', 'Vigorosa e persuasiva', 'Proibida'], correct: 'Informativa e moderada', basis: 'CED, Art. 28-44', explanation: 'A publicidade do advogado deve ser informativa e moderada.', legTitle: 'Codigo de Etica', topic: 'Publicidade' },
      { q: 'O advogado pode recusar um caso por:', opts: ['Qualquer motivo', 'Razoes de foro intimo', 'Apenas por falta de pagamento', 'Nunca pode recusar'], correct: 'Razoes de foro intimo', basis: 'Lei 8.906/94, Art. 7, IV', explanation: 'O advogado pode recusar patrocinio por razoes de foro intimo.', legTitle: 'Estatuto da OAB', topic: 'Recusa de Patrocinio' },
      { q: 'A lide temeraria e aquela em que o advogado:', opts: ['Atua com zelo', 'Cria litigio sem fundamento', 'Defende com vigor', 'Aceita o caso'], correct: 'Cria litigio sem fundamento', basis: 'CED, Art. 15', explanation: 'A lide temeraria e a criacao artificial de litigio.', legTitle: 'Codigo de Etica', topic: 'Lide Temeraria' },
      { q: 'O honorario de sucumbencia e devido:', opts: ['Apenas quando contratado', 'Ao advogado que vence a causa para o cliente', 'Apenas em causas civeis', 'Nunca e devido'], correct: 'Ao advogado que vence a causa para o cliente', basis: 'Lei 8.906/94, Art. 22', explanation: 'O honorario de sucumbencia e devido ao advogado pela parte vencida.', legTitle: 'Estatuto da OAB', topic: 'Honorarios' },
      { q: 'A OAB e um:', opts: ['Orgao publico', 'Entidade de classe com funcao institucional', 'Empresa privada', 'Autarquia comum'], correct: 'Entidade de classe com funcao institucional', basis: 'Lei 8.906/94, Art. 44', explanation: 'A OAB e pessoa juridica de direito publico, com funcao institucional.', legTitle: 'Estatuto da OAB', topic: 'Natureza Juridica' },
      { q: 'O exame de ordem e obrigatorio para:', opts: ['Apenas bachareis em direito', 'Todos que queiram exercer a advocacia', 'Apenas estrangeiros', 'Ninguem'], correct: 'Todos que queiram exercer a advocacia', basis: 'Lei 8.906/94, Art. 8', explanation: 'O Exame da Ordem e requisito para inscricao como advogado.', legTitle: 'Estatuto da OAB', topic: 'Exame de Ordem' },
    ],
  };

  const difficulties = ['easy', 'medium', 'hard'] as const;
  const examBoards = ['FGV', 'CESPE'] as const;
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024];

  for (const discipline of DISCIPLINES) {
    const disciplineKey = discipline === 'Direito Tributario' ? 'Direito Tributario' :
      discipline === 'Etica Profissional' ? 'Etica Profissional' : discipline;
    const tpls = templates[disciplineKey] || templates[discipline] || [];

    for (const t of tpls) {
      questions.push({
        id: `q${String(id).padStart(4, '0')}`,
        question_text: t.q,
        options: t.opts,
        correct_answer: t.correct,
        legal_basis: t.basis,
        explanation: t.explanation,
        legislation_link: 'http://www.planalto.gov.br',
        legislation_title: t.legTitle,
        difficulty: difficulties[Math.floor(Math.random() * 3)],
        discipline,
        topic: t.topic,
        exam_board: examBoards[Math.floor(Math.random() * 2)],
        year: years[Math.floor(Math.random() * years.length)],
        phase: '1st',
      });
      id++;
    }
  }

  return questions;
}

export const mockUserAnswers = generateMockAnswers();

function generateMockAnswers() {
  const answers = [];
  const questions = mockQuestions;

  for (let i = 0; i < 50; i++) {
    const q = questions[Math.floor(Math.random() * questions.length)];
    const isCorrect = Math.random() > 0.35;
    answers.push({
      id: `a${String(i + 1).padStart(4, '0')}`,
      user_id: mockUser.id,
      question_id: q.id,
      user_answer: isCorrect ? q.correct_answer : q.options.find(o => o !== q.correct_answer) || q.options[0],
      correct: isCorrect,
      time_spent: Math.floor(Math.random() * 120) + 10,
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return answers;
}
