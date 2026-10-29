// 群聊与私人会话的压缩引擎：dsh 内建的 compaction-basic，摘要前面多贴一张标签（见 compaction-label.mjs）。
// 预设里 compaction-basic 那一项的 name 换成 dsh-social-runtime/compaction 就由这里接手。
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic';
import { withSummaryLabel } from './compaction-label.mjs';

export default withSummaryLabel(BasicCompactionEngine);
