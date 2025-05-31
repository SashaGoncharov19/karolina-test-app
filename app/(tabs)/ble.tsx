import { BleManager, Device, State, Characteristic, Subscription } from 'react-native-ble-plx';
import { useEffect, useState, useRef } from 'react';
import {
    Alert,
    PermissionsAndroid,
    Platform,
    View,
    Text,
    Button,
    StyleSheet,
    TextInput,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native';
import { Buffer } from 'buffer';

// --- Configuration to match your Raspberry Pi BLE Peripheral ---
const RPI_PERIPHERAL_NAME_TARGET = 'MyRaspberryPiSettings'; // Name set on your RPi
const RPI_SERVICE_UUID = '11111111-2222-3333-4444-555555555555';
const RPI_CHARACTERISTIC_UUID = '66666666-7777-8888-9999-000000000000';
// --- End Configuration ---

// Create BLE manager instance (once)
const manager = new BleManager();

const BluetoothClient = () => {
    const [isScanning, setIsScanning] = useState(false);
    const [foundDevices, setFoundDevices] = useState<Device[]>([]);
    const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
    const [isConnecting, setIsConnecting] = useState(false);

    const [permissionsGranted, setPermissionsGranted] = useState(false);
    const [bluetoothState, setBluetoothState] = useState<State | null>(null);
    const [statusMessage, setStatusMessage] = useState('Initializing Bluetooth...');
    const [dataToSend, setDataToSend] = useState('Hello from RN!');
    const [receivedData, setReceivedData] = useState<string | null>(null);

    const deviceRef = useRef<Device | null>(null); // Holds the currently connected or connecting device
    const disconnectSubscriptionRef = useRef<Subscription | null>(null);

    // Request Android permissions (same as before)
    const requestAndroidPermissions = async () => {
        if (Platform.OS !== 'android') return true;
        const apiLevel = parseInt(Platform.Version.toString(), 10);
        if (apiLevel < 31) { // Android 11 (API 30) and below
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                {
                    title: "Location Permission Required",
                    message: "This app needs to access your location to find nearby Bluetooth LE devices.",
                    buttonPositive: "OK", // THIS WAS MISSING
                    buttonNegative: "Cancel", // Optional, but good practice
                    // buttonNeutral: "Ask Me Later" // Optional
                }
            );
            return granted === PermissionsAndroid.RESULTS.GRANTED;
        } else {
            const result = await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            ]);
            return (
                result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
                result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
            );
        }
    };

    useEffect(() => {
        const btStateSubscription = manager.onStateChange((state) => {
            console.log('Bluetooth state:', state);
            setBluetoothState(state);
            if (state === State.PoweredOn) {
                setStatusMessage('Bluetooth is On. Requesting permissions...');
                checkAndRequestPermissions();
            } else {
                setStatusMessage(state === State.PoweredOff ? 'Please turn on Bluetooth' : `Bluetooth state: ${state}`);
                setPermissionsGranted(false);
                setIsScanning(false);
                // If BT turns off, ensure we attempt to clean up connection state
                if (deviceRef.current) {
                    // No await here, best effort
                    deviceRef.current.cancelConnection().catch(e => console.log("Error cancelling connection on BT off:", e));
                }
                setConnectedDevice(null);
                deviceRef.current = null;
                setFoundDevices([]); // Clear found devices if BT is off
            }
        }, true);

        return () => {
            btStateSubscription.remove();
            manager.stopDeviceScan();
            if (disconnectSubscriptionRef.current) {
                disconnectSubscriptionRef.current.remove();
            }
            // Consider if manager.destroy() is needed on app close, but usually not for component unmount
            // if (deviceRef.current) { // Ensure disconnection if component unmounts while connected
            //    deviceRef.current.cancelConnection();
            // }
        };
    }, []);

    const checkAndRequestPermissions = async () => {
        try {
            const granted = await requestAndroidPermissions();
            setPermissionsGranted(granted);
            setStatusMessage(granted ? 'Permissions granted. Ready.' : 'Bluetooth permissions denied.');
            if (!granted) Alert.alert('Permissions Denied', 'Required Bluetooth permissions were not granted.');
        } catch (error) {
            console.error('Permission error:', error);
            setStatusMessage('Error requesting permissions.');
        }
    };

    const startScan = () => {
        if (isScanning) return; // Already scanning
        if (!permissionsGranted || bluetoothState !== State.PoweredOn) {
            Alert.alert('Cannot Scan', 'Enable Bluetooth and grant permissions.');
            return;
        }

        // Reset states for a new scan
        setFoundDevices([]);
        if (connectedDevice) { // If already connected, prompt to disconnect first or handle as needed
            Alert.alert("Already Connected", "Please disconnect from the current device before scanning for new ones.", [{ text: "OK" }]);
            return;
        }
        // Or, if you want to allow scanning while connected to *another* device (not typical for single device connection apps)
        // setConnectedDevice(null);
        // deviceRef.current = null;


        setIsScanning(true);
        setStatusMessage(`Scanning for devices (especially "${RPI_PERIPHERAL_NAME_TARGET}")...`);

        manager.startDeviceScan([RPI_SERVICE_UUID], null, (error, scannedDevice) => {
            if (error) {
                console.error('Scan error:', error);
                setStatusMessage(`Scan error: ${error.message}`);
                setIsScanning(false); // Stop scanning on error
                return;
            }

            if (scannedDevice) {
                // Add device to list if it's not already there
                setFoundDevices((prevDevices) => {
                    if (!prevDevices.find(d => d.id === scannedDevice.id)) {
                        console.log(`Found: ${scannedDevice.name || 'Unnamed'} (ID: ${scannedDevice.id})`);
                        return [...prevDevices, scannedDevice];
                    }
                    return prevDevices;
                });
            }
        });

        // Stop scan after a timeout
        setTimeout(() => {
            if (isScanning) { // Check if it's still in scanning state (might have been stopped by connection)
                manager.stopDeviceScan();
                setIsScanning(false);
                setStatusMessage(foundDevices.length > 0 ? 'Scan finished. Select a device.' : 'Scan finished. No devices found.');
            }
        }, 10000); // Scan for 10 seconds
    };

    const handleConnect = async (device: Device) => {
        if (isConnecting || connectedDevice) {
            console.log("Already connecting or connected to a device.");
            return;
        }

        setIsConnecting(true);
        setStatusMessage(`Connecting to ${device.name || device.id}...`);
        if (isScanning) { // Stop scanning if we are trying to connect
            manager.stopDeviceScan();
            setIsScanning(false);
        }

        // Clean up previous disconnect listener if any
        if (disconnectSubscriptionRef.current) {
            disconnectSubscriptionRef.current.remove();
            disconnectSubscriptionRef.current = null;
        }

        try {
            deviceRef.current = device; // Set ref early

            disconnectSubscriptionRef.current = device.onDisconnected((error, disconnectedDevice) => {
                console.log(`Device ${disconnectedDevice?.name || device.id} disconnected`, error);
                setStatusMessage(`Disconnected from ${disconnectedDevice?.name || device.id}`);
                setConnectedDevice(null);
                deviceRef.current = null;
                if (disconnectSubscriptionRef.current) { // Clean itself up
                    disconnectSubscriptionRef.current.remove();
                    disconnectSubscriptionRef.current = null;
                }
                // Optionally clear found devices or allow re-scan
                // setFoundDevices([]);
            });

            const connected = await device.connect({ autoConnect: false, requestMTU: 251 }); // Example: request higher MTU
            setStatusMessage(`Connected to ${connected.name || connected.id}. Discovering services...`);

            const deviceWithServices = await connected.discoverAllServicesAndCharacteristics();
            setConnectedDevice(deviceWithServices);
            setStatusMessage(`Ready to interact with ${deviceWithServices.name || deviceWithServices.id}.`);
            setFoundDevices([]); // Clear list of found devices after successful connection
        } catch (error) {
            console.error('Connection error:', error);
            setStatusMessage(`Connection failed: ${(error as Error).message}`);
            // Clean up on failed connection
            if (disconnectSubscriptionRef.current) {
                disconnectSubscriptionRef.current.remove();
                disconnectSubscriptionRef.current = null;
            }
            if (deviceRef.current && deviceRef.current.id === device.id) { // Only nullify if it's the same device we tried to connect
                deviceRef.current = null;
            }
        } finally {
            setIsConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        if (deviceRef.current) {
            setIsConnecting(true); // Use isConnecting as a general "busy" flag for BLE ops
            setStatusMessage(`Disconnecting from ${deviceRef.current.name || deviceRef.current.id}...`);
            try {
                await deviceRef.current.cancelConnection();
                // The onDisconnected listener should handle state updates
                console.log("Cancel connection called successfully.");
            } catch (e) {
                console.error("Failed to disconnect:", e);
                setStatusMessage(`Error disconnecting: ${(e as Error).message}`);
                // Fallback state cleanup if onDisconnected doesn't fire or errors occur
                setConnectedDevice(null);
                deviceRef.current = null;
                if (disconnectSubscriptionRef.current) {
                    disconnectSubscriptionRef.current.remove();
                    disconnectSubscriptionRef.current = null;
                }
            } finally {
                setIsConnecting(false);
            }
        } else {
            setStatusMessage("Not connected to any device.");
        }
    };

    const sendData = async () => {
        if (!deviceRef.current || !connectedDevice) {
            Alert.alert('Error', 'No device connected.');
            return;
        }
        try {
            setStatusMessage(`Sending: "${dataToSend}"`);
            const dataBase64 = Buffer.from(dataToSend, 'utf8').toString('base64');
            await deviceRef.current.writeCharacteristicWithResponseForService(
                RPI_SERVICE_UUID,
                RPI_CHARACTERISTIC_UUID,
                dataBase64
            );
            setStatusMessage(`Data "${dataToSend}" sent successfully!`);
        } catch (error) {
            console.error('Data send error:', error);
            setStatusMessage(`Send error: ${(error as Error).message}`);
        }
    };

    const readCharacteristicData = async () => {
        if (!deviceRef.current || !connectedDevice) {
            Alert.alert('Error', 'No device connected.');
            return;
        }
        try {
            setStatusMessage('Reading data...');
            const characteristic : Characteristic = await deviceRef.current.readCharacteristicForService(
                RPI_SERVICE_UUID,
                RPI_CHARACTERISTIC_UUID
            );
            const rawData = Buffer.from(characteristic.value || '', 'base64').toString('utf8');
            setReceivedData(rawData);
            setStatusMessage(`Received: ${rawData}`);
        } catch (error) {
            console.error('Read error:', error);
            setStatusMessage(`Read error: ${(error as Error).message}`);
        }
    };

    const renderDeviceItem = ({ item }: { item: Device }) => (
        <TouchableOpacity style={styles.deviceItem} onPress={() => handleConnect(item)}>
            <Text style={styles.deviceName}>{item.name || 'Unnamed Device'}</Text>
            <Text style={styles.deviceId}>{item.id}</Text>
            {item.rssi && <Text style={styles.deviceRssi}>RSSI: {item.rssi}</Text>}
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <Text style={styles.title}>RPi BLE Control</Text>
            <Text style={styles.status} numberOfLines={2}>{statusMessage}</Text>
            <Text style={styles.statusInfo}>
                BT: {bluetoothState ?? 'N/A'} | Perms: {permissionsGranted ? 'OK' : 'No'}
                {isConnecting && " | Connecting..."}
            </Text>

            {!connectedDevice ? (
                <>
                    <View style={styles.buttonContainer}>
                        <Button
                            title={isScanning ? "Scanning..." : `Scan for Devices`}
                            onPress={startScan}
                            disabled={isScanning || isConnecting || bluetoothState !== State.PoweredOn || !permissionsGranted}
                        />
                    </View>
                    {isScanning && <ActivityIndicator size="large" color="#0000ff" style={{marginVertical: 10}}/>}
                    <FlatList
                        data={foundDevices}
                        renderItem={renderDeviceItem}
                        keyExtractor={(item) => item.id}
                        style={styles.list}
                        ListEmptyComponent={<Text style={styles.emptyListText}>{isScanning ? '' : 'No devices found yet. Try scanning.'}</Text>}
                    />
                </>
            ) : (
                <View style={styles.connectedView}>
                    <Text style={styles.deviceInfo}>
                        Connected to: {connectedDevice.name || connectedDevice.id}
                    </Text>
                    <TextInput
                        style={styles.input}
                        onChangeText={setDataToSend}
                        value={dataToSend}
                        placeholder="Enter data to send"
                    />
                    <View style={styles.buttonContainer}>
                        <Button title="Send Data" onPress={sendData} disabled={isConnecting} />
                    </View>
                    <View style={styles.buttonContainer}>
                        <Button title="Read Data" onPress={readCharacteristicData} disabled={isConnecting}/>
                    </View>
                    {receivedData && (
                        <Text style={styles.statusInfo}>Last received: {receivedData}</Text>
                    )}
                    <View style={styles.buttonContainer}>
                        <Button title="Disconnect" onPress={handleDisconnect} color="orange" disabled={isConnecting}/>
                    </View>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: Platform.OS === 'android' ? 20 : 50,
        paddingHorizontal: 20,
    },
    title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
    status: { fontSize: 16, textAlign: 'center', marginVertical: 5, minHeight: 40 },
    statusInfo: { fontSize: 13, textAlign: 'center', color: '#555', marginBottom: 10 },
    buttonContainer: { marginVertical: 8, width: '90%', alignSelf: 'center' },
    list: { maxHeight: 250, width: '100%', marginVertical: 10 }, // Max height for the list
    deviceItem: {
        padding: 15,
        marginVertical: 5,
        backgroundColor: '#f0f0f0',
        borderRadius: 5,
        borderWidth: 1,
        borderColor: '#ddd',
    },
    deviceName: { fontSize: 16, fontWeight: 'bold' },
    deviceId: { fontSize: 12, color: '#333' },
    deviceRssi: { fontSize: 12, color: '#333' },
    emptyListText: { textAlign: 'center', marginTop: 20, fontStyle: 'italic'},
    connectedView: { width: '100%', alignItems: 'center' },
    deviceInfo: { fontSize: 16, fontWeight: '500', marginVertical: 15, textAlign: 'center' },
    input: {
        height: 45,
        borderColor: 'gray',
        borderWidth: 1,
        width: '90%',
        paddingHorizontal: 10,
        marginBottom: 10,
        borderRadius: 5,
    },
});

export default BluetoothClient;