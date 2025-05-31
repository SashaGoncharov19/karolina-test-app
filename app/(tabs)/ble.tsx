import { BleManager, Device, State, Characteristic } from 'react-native-ble-plx';
import { useEffect, useState, useRef } from 'react';
import { Alert, PermissionsAndroid, Platform, View, Text, Button, StyleSheet, TextInput } from 'react-native';
import { Buffer } from 'buffer'; // Import Buffer

// --- Configuration to match your Raspberry Pi BLE Peripheral ---
const RPI_PERIPHERAL_NAME = 'MyRaspberryPiSettings'; // Name set on your RPi
const RPI_SERVICE_UUID = '11111111-2222-3333-4444-555555555555'; // Service UUID from your RPi
const RPI_CHARACTERISTIC_UUID = '66666666-7777-8888-9999-000000000000'; // Characteristic UUID from your RPi
// --- End Configuration ---

// Create BLE manager instance
const manager = new BleManager();

const BluetoothClient = () => {
    const [isScanning, setIsScanning] = useState(false);
    const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
    const [permissionsGranted, setPermissionsGranted] = useState(false);
    const [bluetoothState, setBluetoothState] = useState<State | null>(null);
    const [statusMessage, setStatusMessage] = useState('Initializing Bluetooth...');
    const [dataToSend, setDataToSend] = useState('Hello from RN!'); // State for the input field
    const [receivedData, setReceivedData] = useState<string | null>(null); // State for received data (if reading/notifying)

    const deviceRef = useRef<Device | null>(null); // Using ref to hold the device instance for connect/disconnect

    // Request Android permissions
    const requestAndroidPermissions = async () => {
        if (Platform.OS !== 'android') return true;

        const apiLevel = parseInt(Platform.Version.toString(), 10);

        if (apiLevel < 31) { // Android 11 (API 30) and below
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                {
                    title: "Location Permission Required",
                    message: "This app needs to access your location to find nearby Bluetooth LE devices.",
                    buttonNeutral: "Ask Me Later",
                    buttonNegative: "Cancel",
                    buttonPositive: "OK"
                }
            );
            return granted === PermissionsAndroid.RESULTS.GRANTED;
        } else { // Android 12 (API 31) and above
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

    // Start BLE operations
    useEffect(() => {
        const subscription = manager.onStateChange((state) => {
            console.log('Bluetooth state:', state);
            setBluetoothState(state);
            if (state === State.PoweredOn) {
                setStatusMessage('Bluetooth is On. Requesting permissions...');
                checkAndRequestPermissions();
            } else if (state === State.PoweredOff) {
                setStatusMessage('Please turn on Bluetooth');
                setPermissionsGranted(false); // Reset permissions status if BT is off
                if (deviceRef.current) {
                    deviceRef.current.cancelConnection(); // Attempt to cancel if BT turns off
                    setConnectedDevice(null);
                    deviceRef.current = null;
                }
            }
        }, true); // Emit current state immediately

        return () => {
            subscription.remove();
            manager.stopDeviceScan();
            if (deviceRef.current) {
                deviceRef.current.cancelConnection();
            }
            // manager.destroy(); // Consider destroying only when component unmounts permanently
        };
    }, []); // Empty dependency array, runs once

    const checkAndRequestPermissions = async () => {
        try {
            const granted = await requestAndroidPermissions();
            setPermissionsGranted(granted);

            if (granted) {
                setStatusMessage('Permissions granted. Ready to scan.');
            } else {
                setStatusMessage('Bluetooth permissions denied. Cannot scan.');
                Alert.alert('Permissions Denied', 'Bluetooth permissions are required to use this feature.');
            }
        } catch (error) {
            console.error('Permission error:', error);
            setStatusMessage('Error requesting permissions.');
        }
    };

    const startScan = () => {
        if (!permissionsGranted || bluetoothState !== State.PoweredOn) {
            Alert.alert(
                'Cannot Scan',
                'Please ensure Bluetooth is turned on and all required permissions are granted.'
            );
            return;
        }

        if (isScanning) return;

        setIsScanning(true);
        setConnectedDevice(null); // Clear previous connection
        deviceRef.current = null;
        setStatusMessage(`Scanning for "${RPI_PERIPHERAL_NAME}"...`);
        setReceivedData(null);

        // Scan for devices advertising the specific service UUID
        manager.startDeviceScan([RPI_SERVICE_UUID], null, (error, scannedDevice) => {
            if (error) {
                console.error('Scan error:', error);
                setStatusMessage(`Scan error: ${error.message}`);
                setIsScanning(false);
                // Consider more specific error handling, e.g., BT not authorized for scan
                if (error.errorCode === 201) { // BleErrorCode.BluetoothUnauthorized
                    Alert.alert("Authorization Error", "Bluetooth permission not authorized for scanning.");
                }
                return;
            }

            if (scannedDevice) {
                console.log(`Found device: ${scannedDevice.name} (ID: ${scannedDevice.id}, Service: ${scannedDevice.serviceUUIDs})`);
                // Check if the found device matches our target peripheral name
                if (scannedDevice.name === RPI_PERIPHERAL_NAME) {
                    manager.stopDeviceScan();
                    setIsScanning(false);
                    setStatusMessage(`Found ${RPI_PERIPHERAL_NAME}! Connecting...`);
                    connectToDevice(scannedDevice);
                }
            }
        });

        // Stop scan after a timeout if not found
        setTimeout(() => {
            if (isScanning) { // Check if still scanning
                manager.stopDeviceScan();
                setIsScanning(false);
                setStatusMessage(`Scan timeout. Could not find "${RPI_PERIPHERAL_NAME}".`);
            }
        }, 15000); // Increased timeout to 15 seconds
    };

    const connectToDevice = async (device: Device) => {
        try {
            deviceRef.current = device; // Store device instance

            // Optional: Listen for disconnection
            const disconnectSubscription = device.onDisconnected((error, disconnectedDevice) => {
                console.log(`Device ${disconnectedDevice.name} disconnected`, error);
                setStatusMessage(`Disconnected from ${disconnectedDevice.name}`);
                setConnectedDevice(null);
                deviceRef.current = null;
                if (disconnectSubscription) {
                    disconnectSubscription.remove();
                }
            });

            const connected = await device.connect();
            setStatusMessage(`Connected to ${connected.name}. Discovering services...`);

            const deviceWithServices = await connected.discoverAllServicesAndCharacteristics();
            setConnectedDevice(deviceWithServices); // Update state with fully discovered device
            setStatusMessage(`Ready to interact with ${deviceWithServices.name}.`);

            // Optional: Attempt to read initial value after connection
            // readCharacteristicData();

        } catch (error) {
            console.error('Connection error:', error);
            setStatusMessage(`Connection error: ${(error as Error).message}`);
            setConnectedDevice(null);
            deviceRef.current = null;
        }
    };

    const sendData = async () => {
        if (!deviceRef.current || !connectedDevice) { // Check both refs
            setStatusMessage('No device connected to send data.');
            Alert.alert('Error', 'No device connected.');
            return;
        }

        try {
            setStatusMessage(`Sending: "${dataToSend}"`);
            // Data must be Base64 encoded for writeCharacteristicWithResponse
            const dataBase64 = Buffer.from(dataToSend, 'utf8').toString('base64');

            await deviceRef.current.writeCharacteristicWithResponseForService(
                RPI_SERVICE_UUID,
                RPI_CHARACTERISTIC_UUID,
                dataBase64
            );
            setStatusMessage(`Data "${dataToSend}" sent successfully!`);
        } catch (error) {
            console.error('Data send error:', error);
            setStatusMessage(`Data send error: ${(error as Error).message}`);
            Alert.alert('Send Error', `Failed to send data: ${(error as Error).message}`);
        }
    };

    // Optional: Function to read data if your characteristic supports it
    const readCharacteristicData = async () => {
        if (!deviceRef.current || !connectedDevice) {
            setStatusMessage('No device connected to read data.');
            return;
        }
        try {
            setStatusMessage('Reading data...');
            const characteristic : Characteristic = await deviceRef.current.readCharacteristicForService(
                RPI_SERVICE_UUID,
                RPI_CHARACTERISTIC_UUID
            );
            // Data is base64 encoded, decode it
            const rawData = Buffer.from(characteristic.value || '', 'base64').toString('utf8');
            setReceivedData(rawData);
            setStatusMessage(`Received: ${rawData}`);
        } catch (error) {
            console.error('Read error:', error);
            setStatusMessage(`Read error: ${(error as Error).message}`);
        }
    };

    // Simple UI
    return (
        <View style={styles.container}>
            <Text style={styles.title}>RPi Bluetooth Control</Text>
            <Text style={styles.status}>{statusMessage}</Text>
            <Text style={styles.statusInfo}>
                BT State: {bluetoothState ?? 'Unknown'} | Permissions: {permissionsGranted ? 'Granted' : 'Not Granted'}
            </Text>

            {!connectedDevice ? (
                <View style={styles.buttonContainer}>
                    <Button
                        title={isScanning ? "Scanning..." : `Scan for ${RPI_PERIPHERAL_NAME}`}
                        onPress={startScan}
                        disabled={isScanning || bluetoothState !== State.PoweredOn || !permissionsGranted}
                    />
                </View>
            ) : (
                <>
                    <Text style={styles.deviceInfo}>
                        Connected to: {connectedDevice.name || 'Unnamed device'}
                    </Text>
                    <TextInput
                        style={styles.input}
                        onChangeText={setDataToSend}
                        value={dataToSend}
                        placeholder="Enter data to send"
                    />
                    <View style={styles.buttonContainer}>
                        <Button
                            title="Send Data to RPi"
                            onPress={sendData}
                        />
                    </View>
                    <View style={styles.buttonContainer}>
                        <Button
                            title="Read Data from RPi"
                            onPress={readCharacteristicData}
                        />
                    </View>
                    {receivedData && (
                        <Text style={styles.statusInfo}>Last received: {receivedData}</Text>
                    )}
                    <View style={styles.buttonContainer}>
                        <Button
                            title="Disconnect"
                            onPress={() => {
                                if (deviceRef.current) deviceRef.current.cancelConnection();
                            }}
                            color="orange"
                        />
                    </View>
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start', // Changed to flex-start
        paddingTop: 50, // Added padding top
        paddingHorizontal: 20,
    },
    title: {
        fontSize: 22, // Adjusted
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
    },
    status: {
        fontSize: 16,
        marginVertical: 8, // Adjusted
        textAlign: 'center',
    },
    statusInfo: {
        fontSize: 13, // Adjusted
        marginVertical: 4, // Adjusted
        textAlign: 'center',
        color: '#555',
    },
    buttonContainer: {
        marginVertical: 8, // Adjusted
        width: '90%', // Adjusted
    },
    deviceInfo: {
        marginTop: 15, // Adjusted
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 10, // Added
        textAlign: 'center',
    },
    input: {
        height: 40,
        borderColor: 'gray',
        borderWidth: 1,
        width: '90%',
        paddingHorizontal: 10,
        marginBottom: 10,
        borderRadius: 5,
    }
});

export default BluetoothClient;