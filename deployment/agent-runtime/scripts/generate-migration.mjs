import { writeFile } from 'node:fs/promises';
import { AGENT_SESSION_PG_SCHEMA } from '@openmaic/storage/agent-session/pg';
import { TEACHING_AGENT_REQUEST_SCHEMA } from '../src/request-store.js';

const header = `-- Generated from @openmaic/storage@0.29.0. Do not edit by hand.\n-- Regenerate with: npm run migration:generate\n\nCREATE SCHEMA IF NOT EXISTS agent_runtime;\nREVOKE ALL ON SCHEMA agent_runtime FROM PUBLIC;\nSET search_path TO agent_runtime;\n\n`;
const footer = `\n\nRESET search_path;\n`;
await writeFile(new URL('../migrations/0001_agent_runtime.sql', import.meta.url), `${header}${AGENT_SESSION_PG_SCHEMA.trim()}\n\n${TEACHING_AGENT_REQUEST_SCHEMA.trim()}${footer}`);
