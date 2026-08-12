import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';

import * as api from '@/lib/api';

type Post = { id: number; title: string | null; body: string; visibility: 'public' | 'supporters_only'; published_at: string };

const ROTATE_MS = 6000;

// Bottom ticker showing the creator's most recent text updates — one of the
// three places client/js/posts.js renders posts (the full-list modal and the
// bio-landing "Messages" section are deferred to a later pass).
export function PostsTicker() {
  const { data } = useQuery<{ posts: Post[] }>({ queryKey: ['posts', 'list'], queryFn: () => api.posts.list(1, 5) });
  const posts = data?.posts || [];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (posts.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % posts.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [posts.length]);

  if (!posts.length) return null;
  const post = posts[index % posts.length];

  return (
    <div data-testid="posts-ticker" className="glass-dock">
      <MessageSquare size={13} className="text-primary shrink-0" />
      <span className="truncate">{post.title ? `${post.title} — ` : ''}{post.body}</span>
    </div>
  );
}
