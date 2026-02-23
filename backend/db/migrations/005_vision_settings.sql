-- Migration 005: Add vision model settings for image analysis
INSERT INTO ai_settings (key, value) VALUES
  ('vision_provider', 'openai'),
  ('vision_model', 'gpt-4o')
ON CONFLICT (key) DO NOTHING;
