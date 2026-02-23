import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Hash, Send, Loader2, Users, Search, RefreshCw,
  Lock, MessageSquare, SmilePlus, Pin, Mail,
  FileIcon, Bell, Bookmark, Trash2, Clock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { slackApi } from "@/api/client";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface SlackChannel { channel_id: string; channel_name: string; is_private?: boolean; num_members?: number; topic?: string; }
interface Reaction { emoji: string; count: number; users?: string[]; }
interface LiveMessage { ts: string; user: string; text: string; reply_count?: number; thread_ts?: string; reactions?: Reaction[]; }
interface SlackUser { id: string; name: string; display_name: string; is_bot: boolean; }
interface SlackPin { ts: string; user: string; text: string; }
interface SlackFile { id: string; name: string; title: string; filetype: string; size: number; permalink: string; user: string; created: number; }
interface SlackReminder { id: string; text: string; time: number; complete_ts: number; recurring: boolean; }
interface SlackMember { user_id: string; display_name: string; is_admin: boolean; }
interface SlackBookmark { id: string; title: string; link: string; emoji: string; }

/** Time-frame filter options (hours). 0 = all time / no limit */
const SLACK_TIME_OPTIONS = [
  { value: "0",    label: "All time" },
  { value: "24",   label: "Last 24h" },
  { value: "168",  label: "Last 7 days" },
  { value: "720",  label: "Last 30 days" },
  { value: "2160", label: "Last 90 days" },
];

function formatTs(ts: string) {
  const n = parseFloat(ts);
  if (!n) return ts;
  return new Date(n * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MsgAvatar({ user }: { user: string }) {
  return (
    <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
      {(user || "?")[0].toUpperCase()}
    </div>
  );
}

/** Build a lookup map from user ID → display name */
function useUserMap(users: SlackUser[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of users) {
    map[u.id] = u.display_name || u.name || u.id;
  }
  return map;
}

export default function SlackView() {
  const qc = useQueryClient();
  const { selectedSlackChannel: persistedChannel, setSelectedSlackChannel } = useAppStore();
  const [selectedChannel, setSelectedChannelLocal] = useState<SlackChannel | null>(
    persistedChannel ? { channel_id: persistedChannel.id, channel_name: persistedChannel.name, is_private: persistedChannel.is_private, num_members: persistedChannel.num_members, topic: persistedChannel.topic } : null
  );
  const setSelectedChannel = (ch: SlackChannel | null) => {
    setSelectedChannelLocal(ch);
    if (ch) setSelectedSlackChannel({ id: ch.channel_id, name: ch.channel_name, is_private: ch.is_private, num_members: ch.num_members, topic: ch.topic });
    else setSelectedSlackChannel(null);
  };
  const [composerText, setComposerText] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [threadMsg, setThreadMsg] = useState<LiveMessage | null>(null);
  const [showDM, setShowDM] = useState(false);
  const [dmTarget, setDmTarget] = useState("");
  const [dmText, setDmText] = useState("");
  const [showPins, setShowPins] = useState(false);
  const [reactionMsg, setReactionMsg] = useState<LiveMessage | null>(null);
  const [reactionEmoji, setReactionEmoji] = useState("thumbsup");
  const [showFiles, setShowFiles] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<LiveMessage | null>(null);
  const [messageHours, setMessageHours] = useState(0);

  const syncChannelsMut = useMutation({
    mutationFn: slackApi.syncChannels,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["slack-channels"] }); toast.success("Channels synced"); },
    onError: () => toast.error("Failed to sync channels"),
  });

  const { data: channels = [], isLoading: channelsLoading, isError: channelsError } = useQuery<SlackChannel[]>({
    queryKey: ["slack-channels"], queryFn: slackApi.listChannels,
  });

  const { data: messages = [], isLoading: messagesLoading, isError: messagesError } = useQuery<LiveMessage[]>({
    queryKey: ["slack-live", selectedChannel?.channel_id, messageHours],
    queryFn: () => slackApi.getChannelMessages(selectedChannel!.channel_id, messageHours, 200),
    enabled: !!selectedChannel && !searchActive, retry: false,
  });

  const { data: threadMessages = [], isLoading: threadLoading, isError: threadError } = useQuery<LiveMessage[]>({
    queryKey: ["slack-thread", threadMsg?.thread_ts],
    queryFn: () => slackApi.getThread(selectedChannel!.channel_id, threadMsg!.thread_ts!),
    enabled: !!threadMsg?.thread_ts && !!selectedChannel, retry: false,
  });

  const { data: searchResults = [], isLoading: searchLoading, isError: searchError } = useQuery<LiveMessage[]>({
    queryKey: ["slack-search", searchQ],
    queryFn: () => slackApi.searchMessages(searchQ),
    enabled: searchActive && searchQ.trim().length > 1, retry: false,
  });

  const { data: users = [] } = useQuery<SlackUser[]>({
    queryKey: ["slack-users"],
    queryFn: slackApi.listUsers,
    retry: false,
  });

  const { data: pins = [] } = useQuery<SlackPin[]>({
    queryKey: ["slack-pins", selectedChannel?.channel_id],
    queryFn: () => slackApi.listPins(selectedChannel!.channel_id),
    enabled: !!selectedChannel && showPins,
    retry: false,
  });

  const { data: files = [] } = useQuery<SlackFile[]>({
    queryKey: ["slack-files", selectedChannel?.channel_id],
    queryFn: () => slackApi.listFiles(selectedChannel?.channel_id),
    enabled: showFiles,
    retry: false,
  });

  const { data: reminders = [] } = useQuery<SlackReminder[]>({
    queryKey: ["slack-reminders"],
    queryFn: slackApi.listReminders,
    enabled: showReminders,
    retry: false,
  });

  const { data: members = [] } = useQuery<SlackMember[]>({
    queryKey: ["slack-members", selectedChannel?.channel_id],
    queryFn: () => slackApi.listChannelMembers(selectedChannel!.channel_id),
    enabled: !!selectedChannel && showMembers,
    retry: false,
  });

  const { data: bookmarks = [] } = useQuery<SlackBookmark[]>({
    queryKey: ["slack-bookmarks", selectedChannel?.channel_id],
    queryFn: () => slackApi.listBookmarks(selectedChannel!.channel_id),
    enabled: !!selectedChannel && showBookmarks,
    retry: false,
  });

  const deleteMsgMut = useMutation({
    mutationFn: (msg: LiveMessage) => slackApi.deleteMessage(selectedChannel!.channel_id, msg.ts),
    onSuccess: () => { toast.success("Message deleted"); qc.invalidateQueries({ queryKey: ["slack-live", selectedChannel?.channel_id] }); },
    onError: () => toast.error("Failed to delete message"),
  });

  const postMut = useMutation({
    mutationFn: () => slackApi.postMessage(selectedChannel!.channel_id, composerText),
    onSuccess: () => {
      toast.success("Message sent"); setComposerText("");
      qc.invalidateQueries({ queryKey: ["slack-live", selectedChannel?.channel_id] });
    },
    onError: () => toast.error("Failed to send message"),
  });

  const dmMut = useMutation({
    mutationFn: () => slackApi.sendDM(dmTarget, dmText),
    onSuccess: () => { toast.success("DM sent"); setShowDM(false); setDmText(""); setDmTarget(""); },
    onError: () => toast.error("Failed to send DM"),
  });

  const reactionMut = useMutation({
    mutationFn: () => slackApi.addReaction(selectedChannel!.channel_id, reactionMsg!.ts, reactionEmoji),
    onSuccess: () => { toast.success(`Reacted with :${reactionEmoji}:`); setReactionMsg(null); },
    onError: () => toast.error("Failed to add reaction"),
  });

  const pinMut = useMutation({
    mutationFn: (msg: LiveMessage) => slackApi.pinMessage(selectedChannel!.channel_id, msg.ts),
    onSuccess: () => { toast.success("Message pinned"); qc.invalidateQueries({ queryKey: ["slack-pins", selectedChannel?.channel_id] }); },
    onError: () => toast.error("Failed to pin message"),
  });

  const displayMessages = searchActive ? searchResults : (threadMsg ? threadMessages : messages);
  const displayLoading = searchActive ? searchLoading : (threadMsg ? threadLoading : messagesLoading);
  const displayError = searchActive ? searchError : (threadMsg ? threadError : messagesError);

  /** Resolve user ID to display name */
  const userMap = useUserMap(users);
  const resolveUser = (userId: string) => userMap[userId] || userId;

  return (
    <>
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-64 shrink-0 flex flex-col bg-sidebar border-r overflow-hidden">
        <div className="px-3 py-2.5 border-b flex items-center gap-2 shrink-0">
          <Hash className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Slack</span>
        </div>
        {/* Search bar */}
        <div className="p-2 border-b shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setSearchActive(e.target.value.length > 1); }}
              onKeyDown={e => e.key === "Escape" && (setSearchQ(""), setSearchActive(false))}
              placeholder="Search messages..." className="h-8 text-xs pl-8" />
          </div>
        </div>
        {/* Channel list */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2">
            <div className="flex items-center justify-between px-1 py-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Channels {channels.length > 0 && `(${channels.length})`}
              </p>
              <button onClick={() => syncChannelsMut.mutate()} disabled={syncChannelsMut.isPending}
                className="text-muted-foreground hover:text-foreground transition-colors" title="Sync channels" aria-label="Sync channels">
                <RefreshCw className={cn("w-3 h-3", syncChannelsMut.isPending && "animate-spin")} />
              </button>
            </div>
            {channelsLoading ? [1,2,3,4].map(i => <Skeleton key={i} className="h-7 mb-1 rounded" />) :
             channelsError ? (
              <div className="px-2 py-4 text-center">
                <p className="text-xs text-destructive font-medium">Failed to load channels</p>
                <p className="text-[11px] text-muted-foreground mt-1">Check Slack connection in Settings</p>
              </div>
            ) :
             channels.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-2">No channels. Connect Slack in Settings.</p>
            ) : channels.map(ch => (
              <button key={ch.channel_id} onClick={() => { setSelectedChannel(ch); setSearchActive(false); setSearchQ(""); setThreadMsg(null); }}
                className={cn("w-full text-left px-2 py-1.5 flex items-center gap-1.5 rounded-md hover:bg-accent transition-colors",
                  selectedChannel?.channel_id === ch.channel_id && "bg-accent")}>
                {ch.is_private ? <Lock className="w-3 h-3 text-muted-foreground shrink-0" /> : <Hash className="w-3 h-3 text-muted-foreground shrink-0" />}
                <span className="text-xs truncate flex-1">{ch.channel_name || ch.channel_id}</span>
                {ch.num_members != null && <span className="text-[10px] text-muted-foreground">{ch.num_members}</span>}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {threadMsg ? (
              <>
                <button onClick={() => setThreadMsg(null)} className="text-muted-foreground hover:text-foreground" aria-label="Back to channel">
                  <MessageSquare className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold">Thread</span>
                <span className="text-xs text-muted-foreground">in #{selectedChannel?.channel_name}</span>
              </>
            ) : selectedChannel ? (
              <>
                {selectedChannel.is_private ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Hash className="w-4 h-4 text-muted-foreground" />}
                <span className="text-sm font-semibold">{selectedChannel.channel_name}</span>
                {selectedChannel.num_members != null && (
                  <Badge variant="secondary" className="text-[10px] gap-1"><Users className="w-2.5 h-2.5" />{selectedChannel.num_members}</Badge>
                )}
                <div className="flex items-center gap-1 ml-2">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <Select value={String(messageHours)} onValueChange={v => setMessageHours(Number(v))}>
                    <SelectTrigger className="h-6 w-28 text-[10px] border-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SLACK_TIME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">{searchActive ? "Search results" : "Select a channel"}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {selectedChannel && (
              <>
                <button onClick={() => setShowPins(p => !p)} className={`p-1.5 rounded hover:bg-accent transition-colors ${showPins ? "bg-accent" : ""}`} title="Pinned messages" aria-label="Pinned messages">
                  <Pin className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => setShowMembers(true)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Channel members" aria-label="Channel members">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => setShowBookmarks(true)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Bookmarks" aria-label="Bookmarks">
                  <Bookmark className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => setShowFiles(true)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Files" aria-label="Files">
                  <FileIcon className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </>
            )}
            <button onClick={() => setShowReminders(true)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Reminders" aria-label="Reminders">
              <Bell className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button onClick={() => setShowDM(true)} className="p-1.5 rounded hover:bg-accent transition-colors" title="Send DM" aria-label="Send direct message">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {!selectedChannel && !searchActive ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <Hash className="w-12 h-12 opacity-30 mb-3" />
            <p className="text-sm font-medium">Select a channel</p>
            <p className="text-xs mt-1">Connect Slack in Settings &rarr; Integrations</p>
          </div>
        ) : (
          <>
            {selectedChannel?.topic && !threadMsg && !searchActive && (
              <div className="px-4 py-1.5 border-b bg-muted/5 text-xs text-muted-foreground">{selectedChannel.topic}</div>
            )}
            <ScrollArea className="flex-1 min-h-0">
              <div className="divide-y">
                {displayLoading ? (
                  <div className="p-4 space-y-3">{[1,2,3].map(i => (
                    <div key={i} className="flex gap-2">
                      <Skeleton className="w-7 h-7 rounded shrink-0" />
                      <div className="flex-1 space-y-1"><Skeleton className="h-3 w-24" /><Skeleton className="h-4 w-full" /></div>
                    </div>
                  ))}</div>
                ) : displayError ? (
                  <div className="flex flex-col items-center py-16 text-destructive">
                    <MessageSquare className="w-10 h-10 opacity-50 mb-2" />
                    <p className="text-sm font-medium">Failed to load messages</p>
                    <p className="text-xs text-muted-foreground mt-1">Check your Slack connection in Settings</p>
                  </div>
                ) : displayMessages.length === 0 ? (
                  <div className="flex flex-col items-center py-16 text-muted-foreground">
                    <MessageSquare className="w-10 h-10 opacity-30 mb-2" />
                    <p className="text-sm">{searchActive ? "No results" : "No messages in this channel"}</p>
                  </div>
                ) : displayMessages.map((msg, idx) => (
                  <div key={msg.ts + idx} className="px-4 py-3 hover:bg-muted/20 transition-colors group">
                    <div className="flex items-start gap-2">
                      <MsgAvatar user={resolveUser(msg.user)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-xs font-semibold">{resolveUser(msg.user)}</span>
                          <span className="text-[11px] text-muted-foreground">{formatTs(msg.ts)}</span>
                          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {selectedChannel && (
                              <>
                                <button onClick={() => { setReactionMsg(msg); }} className="p-1 rounded hover:bg-accent" title="Add reaction" aria-label="Add reaction">
                                  <SmilePlus className="w-3 h-3 text-muted-foreground" />
                                </button>
                                <button onClick={() => pinMut.mutate(msg)} className="p-1 rounded hover:bg-accent" title="Pin message" aria-label="Pin message">
                                  <Pin className="w-3 h-3 text-muted-foreground" />
                                </button>
                                <button onClick={() => setConfirmDeleteMsg(msg)} className="p-1 rounded hover:bg-accent" title="Delete message" aria-label="Delete message">
                                  <Trash2 className="w-3 h-3 text-muted-foreground" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {msg.reactions.map((r, ri) => (
                              <span key={ri} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted/40 border text-[11px] text-muted-foreground hover:bg-muted/60 transition-colors">
                                <span>:{r.emoji}:</span>
                                <span className="font-medium">{r.count}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {!threadMsg && msg.reply_count && msg.reply_count > 0 ? (
                          <button onClick={() => setThreadMsg(msg)}
                            className="mt-1 flex items-center gap-1 text-[11px] text-primary hover:underline">
                            <MessageSquare className="w-3 h-3" />{msg.reply_count} {msg.reply_count === 1 ? "reply" : "replies"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            {selectedChannel && !searchActive && !threadMsg && (
              <div className="border-t p-3 shrink-0">
                <div className="flex items-end gap-2">
                  <Textarea value={composerText} onChange={e => setComposerText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (composerText.trim()) postMut.mutate(); }}}
                    placeholder={`Message #${selectedChannel.channel_name}`}
                    rows={1} className="flex-1 resize-none text-sm min-h-9.5 max-h-24" />
                  <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => postMut.mutate()}
                    disabled={!composerText.trim() || postMut.isPending} aria-label="Send message">
                    {postMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>

    {/* DM dialog */}

    <Dialog open={showDM} onOpenChange={setShowDM}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">Send Direct Message</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Recipient</Label>
            {users.filter(u => !u.is_bot).length > 0 ? (
              <Select value={dmTarget || "__none__"} onValueChange={v => setDmTarget(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select user..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs">Select a user...</SelectItem>
                  {users.filter(u => !u.is_bot).map(u => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">{u.name || u.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={dmTarget} onChange={e => setDmTarget(e.target.value)} placeholder="User ID" className="text-sm h-8" />
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Message</Label>
            <Textarea value={dmText} onChange={e => setDmText(e.target.value)} placeholder="Write your message..." rows={3} className="text-sm resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowDM(false)}>Cancel</Button>
          <Button size="sm" className="text-xs gap-1" disabled={!dmTarget || !dmText.trim() || dmMut.isPending} onClick={() => dmMut.mutate()}>
            {dmMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send DM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Reaction picker dialog */}
    <Dialog open={!!reactionMsg} onOpenChange={o => !o && setReactionMsg(null)}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle className="text-sm">Add Reaction</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Emoji name (without colons)</Label>
            <Select value={reactionEmoji} onValueChange={setReactionEmoji}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["thumbsup","thumbsdown","heart","fire","rocket","eyes","white_check_mark","x","tada","raised_hands"].map(e => (
                  <SelectItem key={e} value={e} className="text-xs">:{e}:</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setReactionMsg(null)}>Cancel</Button>
          <Button size="sm" className="text-xs gap-1" disabled={reactionMut.isPending} onClick={() => reactionMut.mutate()}>
            {reactionMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <SmilePlus className="w-3 h-3" />} React
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Pins panel */}
    <Dialog open={showPins && !!selectedChannel} onOpenChange={setShowPins}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm">Pinned Messages{selectedChannel ? ` · #${selectedChannel.channel_name}` : ""}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {pins.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No pinned messages</p>
          ) : pins.map((p, i) => (
            <div key={i} className="p-2.5 rounded border bg-muted/20 text-xs">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-semibold">{resolveUser(p.user)}</span>
                <span className="text-muted-foreground">{formatTs(p.ts)}</span>
              </div>
              <p className="text-sm">{p.text}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>

    {/* Files dialog */}
    <Dialog open={showFiles} onOpenChange={setShowFiles}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><FileIcon className="w-4 h-4" /> Files{selectedChannel ? ` · #${selectedChannel.channel_name}` : ""}</DialogTitle></DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="space-y-2">
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No files</p>
            ) : files.map(f => (
              <a key={f.id} href={f.permalink} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded border hover:bg-muted/30 transition-colors">
                <FileIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{f.title || f.name}</p>
                  <p className="text-[11px] text-muted-foreground">{f.filetype} · {Math.round(f.size / 1024)}KB · @{f.user}</p>
                </div>
              </a>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    {/* Reminders dialog */}
    <Dialog open={showReminders} onOpenChange={setShowReminders}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><Bell className="w-4 h-4" /> Reminders</DialogTitle></DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="space-y-2">
            {reminders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No reminders</p>
            ) : reminders.map(r => (
              <div key={r.id} className="flex items-start gap-2 p-2 rounded border bg-muted/20">
                <Clock className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs">{r.text}</p>
                  <p className="text-[11px] text-muted-foreground">{r.time ? new Date(r.time * 1000).toLocaleString() : ""} {r.recurring ? "· recurring" : ""} {r.complete_ts ? "· done" : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    {/* Members dialog */}
    <Dialog open={showMembers && !!selectedChannel} onOpenChange={setShowMembers}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> Members{selectedChannel ? ` · #${selectedChannel.channel_name}` : ""}</DialogTitle></DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="space-y-1.5">
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No members</p>
            ) : members.map(m => (
              <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5">
                <MsgAvatar user={m.display_name || m.user_id} />
                <span className="text-xs flex-1 truncate">{m.display_name || m.user_id}</span>
                {m.is_admin && <Badge variant="secondary" className="text-[10px]">admin</Badge>}
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    {/* Bookmarks dialog */}
    <Dialog open={showBookmarks && !!selectedChannel} onOpenChange={setShowBookmarks}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><Bookmark className="w-4 h-4" /> Bookmarks{selectedChannel ? ` · #${selectedChannel.channel_name}` : ""}</DialogTitle></DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="space-y-2">
            {bookmarks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No bookmarks</p>
            ) : bookmarks.map(b => (
              <a key={b.id} href={b.link} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded border hover:bg-muted/30 transition-colors">
                <Bookmark className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{b.emoji ? `${b.emoji} ` : ""}{b.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{b.link}</p>
                </div>
              </a>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    {/* Delete message confirmation dialog */}
    <Dialog open={!!confirmDeleteMsg} onOpenChange={o => !o && setConfirmDeleteMsg(null)}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle className="text-sm">Delete message</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Are you sure you want to delete this message? This action cannot be undone.</p>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setConfirmDeleteMsg(null)}>Cancel</Button>
          <Button size="sm" variant="destructive" className="text-xs" disabled={deleteMsgMut.isPending}
            onClick={() => { if (confirmDeleteMsg) { deleteMsgMut.mutate(confirmDeleteMsg); setConfirmDeleteMsg(null); } }}>
            {deleteMsgMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
