# Cámaras Yi Home

Use sus cámaras Yi Home en Gladys: imagen en directo, detección de movimiento,
modo privado, visión nocturna, giro e inclinación, en las escenas y en el panel.
Todo se queda en su red local: sin cuenta Yi, sin nube.

## Antes de empezar: el firmware yi-hack

El firmware original de las cámaras Yi Home **no ofrece acceso local**: todo
pasa por la nube de Yi y su aplicación, que nadie más puede usar. Esta
integración funciona con las cámaras que llevan el firmware libre **yi-hack**,
que añade un pequeño servidor web a la cámara:

| Su cámara                                                            | Firmware                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Modelos recientes (Yi 1080p Home/Dome/Outdoor desde 2020, Kami…)     | [yi-hack-Allwinner-v2](https://github.com/roleoroleo/yi-hack-Allwinner-v2) |
| Modelos Allwinner (2019–2020)                                        | [yi-hack-Allwinner](https://github.com/roleoroleo/yi-hack-Allwinner)       |
| Modelos MStar (Yi Home 1080p 2018–2019, Yi Dome 1080p…)              | [yi-hack-MStar](https://github.com/roleoroleo/yi-hack-MStar)               |
| Modelos HiSilicon antiguos (Yi Home 720p/1080p, Yi Dome, Yi Outdoor) | [yi-hack-v5](https://github.com/alienatedsec/yi-hack-v5)                   |

Cada proyecto explica cómo encontrar su modelo e instalar el firmware (basta con
una tarjeta microSD, no hay que abrir nada). Después, para cada cámara:

1. Dele una **dirección IP fija** (una reserva DHCP en su router).
2. Abra su interfaz web (`http://<dirección de la cámara>`) y compruebe que
   funciona.
3. Recomendado: en **Configuration → System**, ponga un usuario y una
   contraseña a la interfaz web.
4. Para la detección de movimiento sin MQTT: en **Camera settings**, active
   **Save video on motion**.

## Configuración

En Gladys: **Integraciones → Yi Home Cameras → Configuración**.

| Campo                      | Qué poner                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Direcciones de las cámaras | La dirección IP de cada cámara, separadas por comas: `192.168.1.20, 192.168.1.21`. Añada `:puerto` si la interfaz web no está en el puerto 80. |
| Usuario / Contraseña       | Los de la interfaz web de yi-hack, si los puso. Los mismos para todas las cámaras.                                                             |
| Intervalo de actualización | Frecuencia de lectura del estado de las cámaras (30 s por defecto).                                                                            |
| Intervalo de imágenes      | Frecuencia de envío de una nueva imagen a Gladys (60 s por defecto, 10 s como mínimo). `0` no envía ninguna: el panel pide una al abrirse.     |
| Resolución de las imágenes | Baja (640×360, ligera) o Alta (1080p). Una imagen alta demasiado pesada para Gladys se envía automáticamente en baja.                          |
| Broker MQTT                | Opcional, para los eventos en tiempo real (ver abajo). Ejemplo: `mqtt://192.168.1.10:1883`.                                                    |
| Usuario / contraseña MQTT  | Los de su broker, si hace falta.                                                                                                               |
| Duración del movimiento    | Cuánto tiempo sigue activo el sensor de movimiento tras una detección cuando la cámara no indica cuándo termina (60 s por defecto).            |

Guarde y haga clic en **Probar la conexión**: la respuesta lista cada cámara
encontrada, su modelo, su firmware, sus posiciones guardadas y cómo se detecta
su movimiento.

Abra después la pestaña **Descubrimiento** y añada las cámaras.

## Lo que ofrece cada cámara en Gladys

| Función              | Descripción                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Imagen               | La última captura; el panel pide una nueva al abrirse.                                                                            |
| Cámara encendida     | Enciende o apaga la cámara (modo privado de yi-hack). Apagada, Gladys deja de mostrar su imagen.                                  |
| Movimiento           | 1 cuando se detecta un movimiento, vuelve a 0 al final.                                                                           |
| LED de estado        | El LED de la parte delantera de la cámara.                                                                                        |
| Visión nocturna (IR) | Las luces infrarrojas.                                                                                                            |
| Señal Wi-Fi          | Calidad del Wi-Fi en % (no aparece en una cámara con cable).                                                                      |
| Mover / Posición     | **Solo modelos motorizados**: girar a la izquierda, a la derecha, arriba, abajo, e ir a una posición guardada en la interfaz web. |

Las funciones se crean con nombres en inglés («Camera on», «Motion»…): puede
renombrarlas en Gladys.

## Detección de movimiento: dos formas

**Sin MQTT (por defecto).** La integración mira las grabaciones de la cámara
cada 10 segundos: un nuevo vídeo significa un movimiento. Hace falta que **Save
video on motion** esté activado en los ajustes de la cámara, y puede haber hasta
un minuto de retraso (la cámara guarda sus vídeos por minutos).

**Con MQTT (recomendado).** El movimiento llega en un segundo aproximadamente,
y con él lo que la IA de la cámara reconoció (persona, vehículo, animal — en los
modelos que la tienen), los ruidos fuertes y el llanto de bebé.

1. Necesita un broker MQTT (por ejemplo el de Gladys, o Mosquitto).
2. En la interfaz web de yi-hack, página **MQTT**: indique el broker, active
   MQTT y dé **a cada cámara su propio prefijo MQTT** (`garaje`, `jardin`…). Con
   el mismo prefijo, dos cámaras no se pueden distinguir.
3. En la configuración de la integración, indique el mismo broker.
4. Haga clic en **Probar la conexión**: cada cámara indica
   `movimiento: MQTT, en tiempo real`.

Los topics y mensajes se leen en cada cámara: si los renombró en yi-hack, no hay
nada que cambiar aquí.

## Escenas

**Disparadores**

- **Una cámara detecta movimiento** — filtro por cámara y por detección
  (movimiento, persona, vehículo, animal). Variables: nombre de la cámara,
  detección.
- **Una cámara oye un sonido** — ruido fuerte o llanto de bebé (MQTT).
  Variables: nombre de la cámara, sonido.
- **Una cámara deja de responder** / **Una cámara vuelve a responder** —
  desenchufada, fuera del alcance del Wi-Fi… Un reinicio pedido desde Gladys no
  los activa.

**Acciones**

- **Tomar una captura** — envía una imagen nueva a Gladys (práctico justo antes
  de una notificación). Salida: imagen tomada.
- **Girar una cámara a una posición** — modelos motorizados, posición 0 a 7.
  Salida: cámara girada.
- **Ajustar la sensibilidad al movimiento** — baja, media, alta. Salida:
  aplicada.
- **Reiniciar una cámara**. Salida: reinicio enviado.

Las funciones **Cámara encendida**, **LED de estado** y **Visión nocturna**
también se controlan con la acción estándar «Controlar un dispositivo».

## Panel

- Widget **Cámara Yi**: elija una cámara en sus ajustes. Muestra la última
  imagen, la conexión, encendido/apagado, el último movimiento, la señal Wi-Fi,
  el espacio libre en la tarjeta SD, y botones: captura, encender/apagar, ir a
  una posición (motorizadas), reiniciar.
- Widget **Cámaras Yi**: todas las cámaras de un vistazo (en línea, apagada,
  movimiento) y un botón para actualizar.

El widget de cámara estándar de Gladys también funciona con estas cámaras.

## Botones de la pantalla de configuración

- **Probar la conexión** — vuelve a leer todas las cámaras e indica lo
  encontrado.
- **Identificar una cámara** — su LED parpadea tres veces: práctico cuando
  varias cámaras se parecen.
- **Reiniciar una cámara**.

## Solución de problemas

| Mensaje                                  | Qué hacer                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| inaccesible / sin respuesta a tiempo     | Compruebe la dirección, que la cámara tiene corriente y está en la misma red que Gladys.       |
| usuario o contraseña incorrectos         | Vuelva a escribir el usuario y la contraseña de la interfaz web de yi-hack.                    |
| no es una cámara con el firmware yi-hack | La dirección responde, pero no es yi-hack: dirección equivocada, o firmware original.          |
| movimiento: no detectado                 | Active **Save video on motion** en la cámara, o configure MQTT.                                |
| prefijo MQTT ya usado por otra cámara    | Dé a cada cámara su propio prefijo en la página MQTT de yi-hack.                               |
| Broker MQTT: no conectado                | Compruebe la dirección del broker, su usuario y contraseña, y que el puerto 1883 está abierto. |

Para más detalles, consulte los registros de la integración en **Ajustes →
Sistema → Integraciones**.

## Privacidad

La integración nunca contacta con la nube de Yi ni con ningún servicio de
Internet. Las imágenes se quedan entre las cámaras y Gladys. Las contraseñas
nunca se escriben en los registros.
