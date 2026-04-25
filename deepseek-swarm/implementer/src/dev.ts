import { loadAgentSettings, runSwarmAgentDev } from 'shared';

await runSwarmAgentDev(
  loadAgentSettings({ useDevEnv: true, requireCoral: false, requireDaytonaExa: false }),
);
