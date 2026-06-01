import { useState, useEffect } from 'react';
import { Calendar, Clock, AlertTriangle, CheckCircle, Target } from 'lucide-react';

interface ExamInfo {
  nextDate: Date;
  daysUntil: number;
  phase: string;
  registrationOpen: boolean;
  registrationDeadline: Date | null;
}

function getNextOabExam(): ExamInfo {
  const now = new Date();
  const examDates = [
    { month: 1, day: 19, phase: '1a Fase', regMonth: 11, regDay: 15 },
    { month: 5, day: 18, phase: '1a Fase', regMonth: 3, regDay: 15 },
    { month: 9, day: 14, phase: '1a Fase', regMonth: 7, regDay: 15 },
  ];

  let nextExam: ExamInfo | null = null;

  for (const exam of examDates) {
    const examDate = new Date(now.getFullYear(), exam.month - 1, exam.day);
    const regDeadline = new Date(now.getFullYear(), exam.regMonth - 1, exam.regDay);

    if (examDate > now) {
      const daysUntil = Math.ceil(
        (examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      nextExam = {
        nextDate: examDate,
        daysUntil,
        phase: exam.phase,
        registrationOpen: now <= regDeadline,
        registrationDeadline: regDeadline,
      };
      break;
    }
  }

  if (!nextExam) {
    const examDate = new Date(now.getFullYear() + 1, 0, 19);
    const daysUntil = Math.ceil(
      (examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    nextExam = {
      nextDate: examDate,
      daysUntil,
      phase: '1a Fase',
      registrationOpen: false,
      registrationDeadline: null,
    };
  }

  return nextExam;
}

function getUrgencyLevel(daysUntil: number): 'urgent' | 'warning' | 'calm' {
  if (daysUntil <= 30) return 'urgent';
  if (daysUntil <= 90) return 'warning';
  return 'calm';
}

const URGENCY_CONFIG = {
  urgent: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    icon: <AlertTriangle className="w-6 h-6 text-red-600" />,
    message: 'A prova esta muito proxima! Intensifique os estudos!',
  },
  warning: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    icon: <Clock className="w-6 h-6 text-yellow-600" />,
    message: 'Tempo moderado. Mantenha uma rotina consistente de estudos.',
  },
  calm: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    icon: <CheckCircle className="w-6 h-6 text-green-600" />,
    message: 'Voce tem tempo suficiente. Planeje com calma.',
  },
};

export default function OabExamCalendar() {
  const [examInfo] = useState<ExamInfo>(getNextOabExam);
  const [, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const urgency = getUrgencyLevel(examInfo.daysUntil);
  const config = URGENCY_CONFIG[urgency];

  const weeksUntil = Math.floor(examInfo.daysUntil / 7);
  const questionsPerDay = examInfo.daysUntil > 0 ? Math.max(5, Math.ceil(500 / examInfo.daysUntil)) : 50;
  const simulationsPerWeek = Math.max(1, Math.ceil(weeksUntil / 4));

  const days = examInfo.daysUntil;
  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;

  return (
    <div className="space-y-6">
      {/* Countdown Card */}
      <div className="bg-gradient-to-r from-[#16161a] to-[#26262c] rounded-xl p-8 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="w-7 h-7 text-[#d9ab53]" strokeWidth={1.75} />
          <h3 className="text-2xl font-bold">Proxima Prova OAB</h3>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur">
            <p className="text-3xl font-bold">{weeks}</p>
            <p className="text-sm text-white/80">Semanas</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur">
            <p className="text-3xl font-bold">{remainingDays}</p>
            <p className="text-sm text-white/80">Dias</p>
          </div>
          <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur">
            <p className="text-3xl font-bold">{days}</p>
            <p className="text-sm text-white/80">Total</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-lg font-semibold">
            {examInfo.nextDate.toLocaleDateString('pt-BR', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p className="text-white/80">{examInfo.phase}</p>
        </div>
      </div>

      {/* Urgency Alert */}
      <div className={`${config.bg} border-2 ${config.border} rounded-xl p-6`}>
        <div className="flex items-start gap-3">
          {config.icon}
          <div>
            <h4 className={`font-bold ${config.text} mb-1`}>
              {urgency === 'urgent' ? 'Atencao!' : urgency === 'warning' ? 'Planejamento' : 'Tranquilidade'}
            </h4>
            <p className="text-gray-700 text-sm">{config.message}</p>
          </div>
        </div>
      </div>

      {/* Registration Info */}
      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="font-bold text-[#16161a] mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-[#16161a]" />
          Informacoes da Inscricao
        </h4>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-gray-100">
            <span className="text-gray-600">Inscricoes abertas</span>
            <span className={`font-semibold ${examInfo.registrationOpen ? 'text-green-600' : 'text-red-600'}`}>
              {examInfo.registrationOpen ? 'Sim' : 'Nao'}
            </span>
          </div>
          {examInfo.registrationDeadline && (
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Prazo de inscricao</span>
              <span className="font-semibold text-[#16161a]">
                {examInfo.registrationDeadline.toLocaleDateString('pt-BR')}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center py-2">
            <span className="text-gray-600">Data da prova</span>
            <span className="font-semibold text-[#16161a]">
              {examInfo.nextDate.toLocaleDateString('pt-BR')}
            </span>
          </div>
        </div>
      </div>

      {/* Study Recommendations */}
      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="font-bold text-[#16161a] mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-[#16161a]" />
          Recomendacoes de Estudo
        </h4>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-[#16161a]/5 rounded-lg p-4">
            <p className="text-2xl font-bold text-[#16161a]">{questionsPerDay}</p>
            <p className="text-sm text-gray-600">Questoes por dia recomendadas</p>
          </div>
          <div className="bg-[#16161a]/5 rounded-lg p-4">
            <p className="text-2xl font-bold text-[#16161a]">{simulationsPerWeek}</p>
            <p className="text-sm text-gray-600">Simulados por semana</p>
          </div>
          <div className="bg-[#16161a]/5 rounded-lg p-4">
            <p className="text-2xl font-bold text-[#16161a]">{weeksUntil}</p>
            <p className="text-sm text-gray-600">Semanas de preparo</p>
          </div>
          <div className="bg-[#16161a]/5 rounded-lg p-4">
            <p className="text-2xl font-bold text-[#16161a]">
              {Math.ceil(questionsPerDay * 1.5)}
            </p>
            <p className="text-sm text-gray-600">Minutos de estudo por dia</p>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl p-6 shadow">
        <h4 className="font-bold text-[#16161a] mb-4">Cronograma Sugerido</h4>
        <div className="space-y-4">
          {weeksUntil > 8 && (
            <div className="flex gap-3">
              <div className="w-3 h-3 rounded-full bg-[#16161a] mt-1.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-800">Semanas 1-4: Revisao Geral</p>
                <p className="text-sm text-gray-600">Estude todas as 11 disciplinas, focando nos conceitos basicos</p>
              </div>
            </div>
          )}
          {weeksUntil > 4 && (
            <div className="flex gap-3">
              <div className="w-3 h-3 rounded-full bg-[#26262c] mt-1.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-800">Semanas 5-8: Simulados Intensivos</p>
                <p className="text-sm text-gray-600">Faca simulados completos e identifique pontos fracos</p>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <div className="w-3 h-3 rounded-full bg-[#16161a] mt-1.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-gray-800">Ultimas 4 semanas: Revisao Focada</p>
              <p className="text-sm text-gray-600">Foque nas disciplinas com menor acuracia e faca revisao espacada</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-3 h-3 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-gray-800">Ultima semana: Descanso e Revisao Leve</p>
              <p className="text-sm text-gray-600">Apenas revisao rapida, sem sobrecarga. Descanse bem!</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
