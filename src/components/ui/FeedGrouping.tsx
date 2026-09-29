"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { ActivityFeed } from "@/types/database";

export interface FeedGroup {
  type: 'single' | 'stacked';
  items: ActivityFeed[];
  workId?: string;
}

/**
 * Groups consecutive EPISODE_THREAD activities with the same work_id.
 * Breaks grouping when a different type or different work appears.
 */
export function groupFeedItems(activities: ActivityFeed[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  let currentStack: ActivityFeed[] = [];
  let currentWorkId: string | null = null;

  for (const activity of activities) {
    if (activity.action_type === 'EPISODE_THREAD' && activity.work_id) {
      if (currentWorkId === activity.work_id) {
        // Same work, add to stack
        currentStack.push(activity);
      } else {
        // Different work or first thread
        // Flush previous stack
        if (currentStack.length > 0) {
          groups.push(currentStack.length > 1 
            ? { type: 'stacked', items: currentStack, workId: currentWorkId! }
            : { type: 'single', items: currentStack }
          );
        }
        currentStack = [activity];
        currentWorkId = activity.work_id;
      }
    } else {
      // Not an EPISODE_THREAD - flush any current stack
      if (currentStack.length > 0) {
        groups.push(currentStack.length > 1 
          ? { type: 'stacked', items: currentStack, workId: currentWorkId! }
          : { type: 'single', items: currentStack }
        );
        currentStack = [];
        currentWorkId = null;
      }
      // Add as single item
      groups.push({ type: 'single', items: [activity] });
    }
  }

  // Flush remaining
  if (currentStack.length > 0) {
    groups.push(currentStack.length > 1 
      ? { type: 'stacked', items: currentStack, workId: currentWorkId! }
      : { type: 'single', items: currentStack }
    );
  }

  return groups;
}

/**
 * Component that renders a stacked group of threads.
 * Shows the latest thread with a badge indicating how many more are inside.
 * Clicking expands to show all threads.
 */
export function StackedThreadBlock({ 
  group, 
  workDetails,
  renderItem 
}: { 
  group: FeedGroup;
  workDetails: Record<string, any>;
  renderItem: (activity: ActivityFeed) => React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const work = group.workId ? workDetails[group.workId] : null;
  const workTitle = work?.title?.english || work?.title?.romaji || 'Unbekannt';
  const hiddenCount = group.items.length - 1;

  return (
    <div className="relative">
      {/* Stack indicator header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-4 py-2 rounded-t-xl bg-[#1a1d24] border border-gray-800 border-b-0 text-sm font-bold text-gray-300 hover:text-white transition-colors"
      >
        <MessageSquare size={14} className="text-blue-500" />
        <span className="flex-1 text-left">
          {group.items.length} Threads für <span className="text-blue-400">{workTitle}</span>
        </span>
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {isExpanded ? (
        // Show all threads
        <div className="flex flex-col gap-2 border border-gray-800 border-t-0 rounded-b-xl p-2 bg-[#141a29]/50">
          {group.items.map(item => (
            <div key={item.activity_id}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      ) : (
        // Show only the latest (first) thread + collapsed indicator
        <div className="border border-gray-800 border-t-0 rounded-b-xl overflow-hidden">
          {renderItem(group.items[0])}
          {hiddenCount > 0 && (
            <button
              onClick={() => setIsExpanded(true)}
              className="w-full py-2 text-xs font-bold text-blue-400 hover:text-blue-300 bg-[#141a29] border-t border-gray-800 transition-colors"
            >
              + {hiddenCount} weitere Threads anzeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
