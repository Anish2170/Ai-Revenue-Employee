import { ActivityView } from '@/components/operations';

// Retains compatibility for existing conversation links while the operational
// activity surface becomes the canonical session view.
export default function ConversationsPage() {
  return <ActivityView />;
}
