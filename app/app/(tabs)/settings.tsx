import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, Switch } from 'react-native';
import { Server, Folder, Cpu, Globe } from 'lucide-react-native';

export default function SettingsScreen() {
  const [serverUrl, setServerUrl] = useState('http://192.168.1.100:5000');
  const [musicFolder, setMusicFolder] = useState('/Users/gm/Music/RPG');
  const [usePerplexity, setUsePerplexity] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.section}>
        <View style={styles.row}>
          <Server size={20} color="#A855F7" />
          <Text style={styles.sectionTitle}>CONEXÃO</Text>
        </View>
        <Text style={styles.label}>URL do Bot Server</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="ex: http://192.168.1.100:5000"
          placeholderTextColor="#4B5563"
        />
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <Folder size={20} color="#A855F7" />
          <Text style={styles.sectionTitle}>ARQUIVOS LOCAL</Text>
        </View>
        <Text style={styles.label}>Pasta de Músicas (no servidor)</Text>
        <TextInput
          style={styles.input}
          value={musicFolder}
          onChangeText={setMusicFolder}
          placeholder="/path/to/music"
          placeholderTextColor="#4B5563"
        />
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <Cpu size={20} color="#A855F7" />
          <Text style={styles.sectionTitle}>INTELIGÊNCIA ARTIFICIAL</Text>
        </View>
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.settingName}>Usar Perplexity (Nuvem)</Text>
            <Text style={styles.settingDesc}>Alternar entre Ollama local e Perplexity</Text>
          </View>
          <Switch
            value={usePerplexity}
            onValueChange={setUsePerplexity}
            trackColor={{ false: '#334155', true: '#A855F7' }}
          />
        </View>
      </View>

      <TouchableOpacity style={styles.saveBtn}>
        <Text style={styles.saveText}>Aplicar Configurações</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.version}>Pipecat GM Assistant v0.1.0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 20,
  },
  section: {
    marginBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  label: {
    color: '#E2E8F0',
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1E293B',
    color: 'white',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 20,
  },
  settingName: {
    color: '#F1F5F9',
    fontSize: 16,
    fontWeight: '600',
  },
  settingDesc: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  saveBtn: {
    backgroundColor: '#A855F7',
    padding: 18,
    borderRadius: 20,
    alignItems: 'center',
    marginTop: 'auto',
    marginBottom: 20,
  },
  saveText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  version: {
    color: '#475569',
    fontSize: 12,
  }
});
