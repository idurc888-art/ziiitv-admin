-- Adicionar colunas streaming e content_type na tabela channels
ALTER TABLE channels 
ADD COLUMN IF NOT EXISTS streaming TEXT,
ADD COLUMN IF NOT EXISTS content_type TEXT;

-- Criar índices para melhorar performance de queries
CREATE INDEX IF NOT EXISTS idx_channels_streaming ON channels(streaming);
CREATE INDEX IF NOT EXISTS idx_channels_content_type ON channels(content_type);
CREATE INDEX IF NOT EXISTS idx_channels_streaming_content_type ON channels(streaming, content_type);

-- Comentários
COMMENT ON COLUMN channels.streaming IS 'Streaming service: netflix, amazon, hbo, disney, paramount, apple, globoplay';
COMMENT ON COLUMN channels.content_type IS 'Content type: movie or series';
