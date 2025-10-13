# Suporte para Português / Portuguese Support

Este sistema suporta totalmente transcrição de áudio em português!

## Configuração / Configuration

Para usar o sistema em português, edite o arquivo `config.yaml`:

```yaml
transcription:
  language: "pt-PT"  # Para Português de Portugal
  # OU
  language: "pt-BR"  # Para Português do Brasil
```

## Diferenças entre pt-PT e pt-BR

- **pt-PT** (Português de Portugal): Melhor para sotaques europeus
- **pt-BR** (Português do Brasil): Melhor para sotaques brasileiros

O Google Speech Recognition suporta ambos os dialetos com alta precisão.

## Como funciona / How it works

1. O sistema captura áudio do seu microfone
2. O áudio é transcrito para texto usando Google Speech Recognition
3. O texto em português é enviado para o LLM
4. O LLM analisa a conversa e recomenda músicas apropriadas

## Exemplo de uso / Usage example

### Em Português de Portugal:
```
Usuário: "Estou com vontade de ouvir algo relaxante"
Sistema: 🎵 Recomendando músicas relaxantes...
```

### Em Português do Brasil:
```
Usuário: "Quero ouvir uma música animada"
Sistema: 🎵 Recomendando músicas animadas...
```

## Dicas para melhor reconhecimento / Tips for better recognition

1. **Qualidade do áudio**: Use um microfone de boa qualidade
2. **Ambiente silencioso**: Reduza ruídos de fundo
3. **Fale claramente**: Pronuncie as palavras claramente
4. **Ajuste o threshold**: Se o sistema não detectar sua voz, diminua o valor de `energy_threshold` no config.yaml:
   ```yaml
   transcription:
     energy_threshold: 2000  # Valor padrão é 4000
   ```

## Testando a transcrição / Testing transcription

Você pode testar a transcrição em português executando:

```bash
python test_transcription_pt.py
```

Este script irá:
1. Capturar 5 segundos de áudio
2. Transcrever em português
3. Mostrar o texto detectado

## Suporte a outros idiomas / Support for other languages

O sistema também suporta outros idiomas. Apenas altere o código da língua:

- `es-ES` - Espanhol (Espanha)
- `fr-FR` - Francês (França)
- `de-DE` - Alemão (Alemanha)
- `it-IT` - Italiano (Itália)
- E muitos outros...

Para lista completa, veja: https://cloud.google.com/speech-to-text/docs/languages
