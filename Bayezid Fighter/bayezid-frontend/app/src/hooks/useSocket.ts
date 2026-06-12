import { useEffect, useState } from 'react';
import { socket } from '../socket';
import { api, Alert } from '../lib/api';
export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);
  const on = (event: string, handler: (...args: any[]) => void) => {
    useEffect(() => {
      socket.on(event, handler);
      return () => {
        socket.off(event, handler);
      };
    }, [event, handler]);
  };
  const emit = (event: string, data?: any) => {
    socket.emit(event, data);
  };
  const joinRoom = (room: string) => {
    socket.emit('join_war_room', room);
  };
  return { isConnected, on, emit, joinRoom };
};
export const useAlertStream = () => {
  const { isConnected, on } = useSocket();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const data = await api.fetchAlerts();
        setAlerts(data.slice(0, 100)); 
      } catch (e) {
        console.error('Failed to fetch initial alerts', e);
      }
    };
    fetchInitial();
  }, []);
  on('new_alert', (newAlert: Alert) => {
    setAlerts((prev) => [newAlert, ...prev].slice(0, 100));
  });
  const totalCount = alerts.length;
  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length;
  const highCount = alerts.filter(a => a.severity === 'HIGH').length;
  return { alerts, isConnected, totalCount, criticalCount, highCount };
};
