// shared/domain/issue-notification.ts
//
// Pure helper that builds the pt-BR e-mail payload sent to the issue requester
// when their issue is closed via the deploy-auto-close workflow.
// No side effects — caller is responsible for enqueuing the relay job.

export interface IssueClosedEmailInput {
  issueNumber: number;
  title: string;
  requesterEmail: string;
}

export interface IssueClosedEmail {
  subject: string;
  body: string;
}

/**
 * Builds the pt-BR e-mail subject and body for an issue-closed notification.
 * The result maps directly to the relay `email` channel job shape
 * `{ channel: "email", to, subject, body }`.
 */
export function buildIssueClosedEmail(input: IssueClosedEmailInput): IssueClosedEmail {
  const { issueNumber, title, requesterEmail } = input;

  const subject = `[Probius] Sua solicitação #${issueNumber} foi resolvida`;

  const body = [
    `Olá,`,
    ``,
    `Sua solicitação "${title}" (issue #${issueNumber}) foi resolvida e publicada em produção.`,
    ``,
    `Acesse a plataforma em https://my.probius.app para conferir as melhorias.`,
    ``,
    `Obrigado pelo seu feedback!`,
    ``,
    `— Equipe Probius`,
    ``,
    `---`,
    `Este e-mail foi enviado para ${requesterEmail} porque você abriu uma solicitação na plataforma Probius.`,
  ].join("\n");

  return { subject, body };
}
