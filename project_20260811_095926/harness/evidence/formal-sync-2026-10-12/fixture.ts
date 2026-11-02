import { writeFileSync } from 'node:fs';
import { createProjectOneState } from '../../../projects/src/lib/game/state';
import { PROJECT_ONE_NPCS } from '../../../projects/src/lib/game/project-one';
writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify({state:createProjectOneState(),npcs:PROJECT_ONE_NPCS.map(n=>({...n,weakness:null}))},null,2));
