import {
  delegateToAgent,
  type DelegateAgentArgs,
} from './delegateToAgent.js';

export type DelegateArgs = Omit<
  DelegateAgentArgs,
  'agent' | 'agentCommand' | 'agentArgs' | 'permissionMode' | 'allowUnsafe'
>;

/** @deprecated Use delegateToAgent with agent="agy". */
export async function delegateToAgy(args: DelegateArgs) {
  return delegateToAgent({
    ...args,
    agent: 'agy',
    permissionMode: 'workspace-write',
  });
}
