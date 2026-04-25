import { loadAgentSettings, runSwarmAgent } from 'shared';

await runSwarmAgent(loadAgentSettings({ requireCoral: true }));
