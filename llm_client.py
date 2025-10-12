"""
LLM integration module supporting OpenAI and Ollama endpoints.
"""

import requests
from typing import List, Dict, Optional
from openai import OpenAI


class LLMClient:
    """Client for interacting with LLM providers (OpenAI, Ollama)."""
    
    def __init__(self, provider: str = "openai", api_key: Optional[str] = None, 
                 base_url: str = "https://api.openai.com/v1", model: str = "gpt-3.5-turbo"):
        """
        Initialize the LLM client.
        
        Args:
            provider: Provider name ("openai" or "ollama")
            api_key: API key for OpenAI (not needed for Ollama)
            base_url: Base URL for the API endpoint
            model: Model name to use
        """
        self.provider = provider
        self.model = model
        self.base_url = base_url
        
        if provider == "openai":
            self.client = OpenAI(api_key=api_key, base_url=base_url)
        elif provider == "ollama":
            # Ollama typically runs on localhost:11434
            if base_url == "https://api.openai.com/v1":
                base_url = "http://localhost:11434/v1"
            self.client = OpenAI(api_key="ollama", base_url=base_url)
        else:
            raise ValueError(f"Unknown provider: {provider}")
    
    def rank_music(self, transcript: str, music_list: List[str], context: str = "") -> List[Dict[str, any]]:
        """
        Rank music based on the transcript and context.
        
        Args:
            transcript: Transcribed speech
            music_list: List of available music titles
            context: Additional context about the situation
            
        Returns:
            List of ranked music with scores and reasoning
        """
        prompt = self._build_ranking_prompt(transcript, music_list, context)
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a music recommendation assistant. Analyze the conversation and recommend appropriate music."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=1000
            )
            
            result_text = response.choices[0].message.content
            rankings = self._parse_rankings(result_text, music_list)
            return rankings
            
        except Exception as e:
            print(f"Error calling LLM: {e}")
            # Return default ranking
            return [{"title": title, "score": 0.5, "reason": "Default ranking"} for title in music_list[:5]]
    
    def _build_ranking_prompt(self, transcript: str, music_list: List[str], context: str) -> str:
        """Build the prompt for music ranking."""
        music_list_str = "\n".join([f"{i+1}. {title}" for i, title in enumerate(music_list)])
        
        prompt = f"""Based on the following conversation transcript, recommend the most appropriate music from the list below.

Transcript: "{transcript}"

{f"Additional Context: {context}" if context else ""}

Available Music:
{music_list_str}

Please analyze the mood, theme, and atmosphere of the conversation, then rank the top 5 most appropriate music tracks. For each recommendation, provide:
1. The music title (exactly as listed)
2. A confidence score from 0.0 to 1.0
3. A brief reason for the recommendation

Format your response as:
TITLE: [exact music title]
SCORE: [0.0-1.0]
REASON: [your reasoning]

(Repeat for each of the top 5 recommendations)
"""
        return prompt
    
    def _parse_rankings(self, response_text: str, music_list: List[str]) -> List[Dict[str, any]]:
        """Parse the LLM response into structured rankings."""
        rankings = []
        lines = response_text.strip().split('\n')
        
        current_entry = {}
        for line in lines:
            line = line.strip()
            if line.startswith('TITLE:'):
                if current_entry:
                    rankings.append(current_entry)
                title = line.replace('TITLE:', '').strip()
                # Find the closest match in music_list
                current_entry = {'title': title, 'score': 0.5, 'reason': ''}
            elif line.startswith('SCORE:'):
                try:
                    score = float(line.replace('SCORE:', '').strip())
                    current_entry['score'] = max(0.0, min(1.0, score))
                except ValueError:
                    current_entry['score'] = 0.5
            elif line.startswith('REASON:'):
                reason = line.replace('REASON:', '').strip()
                current_entry['reason'] = reason
        
        if current_entry and 'title' in current_entry:
            rankings.append(current_entry)
        
        # Sort by score
        rankings.sort(key=lambda x: x['score'], reverse=True)
        
        return rankings[:5]
