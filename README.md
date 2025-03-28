# Configurador RatOS
Este es el repositorio del configurador [RatOS](os.ratrig.com) - una aplicación de aprovisionamiento de impresoras 3D para RatOS con generación de configuración, identificación de placas, aprovisionamiento y flasheo automático.
## Contribución
Todas las solicitudes de extracción (pull requests) que no sean hotfix (es decir, adiciones, mejoras y características) deben enviarse a la rama `development`.
Las correcciones de errores deben enviarse a la rama v2.x y posteriormente fusionarse en `development`.
## Configuración Local
### Requisitos
Esto aún necesita ser dockerizado (se aceptan PR's), pero funcionará en cualquier máquina basada en Linux con los siguientes prerrequisitos:
* Linux o WSL
* VSCode
* Node v20.x (prefiero gestionarlo con [nvm](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating))
* [PNPM](https://pnpm.io/installation)
La mayoría de los scripts bash asumirán que existe el usuario `pi`. Necesita arreglarse, afortunadamente no los necesitas para la mayoría del trabajo.

### Instalación

Clona los repositorios
```bash
mkdir RatOS-dev && cd RatOS-dev
mkdir -p printer_data/ratos
mkdir -p printer_data/logs
mkdir -p printer_data/config
git clone git@github.com:Rat-OS/RatOS-configurator.git
# External dependencies
git clone git@github.com:klipper3d/klipper.git
git clone git@github.com:Arksine/moonraker.git
# Configuration repo
cd printer_data/config
git clone git@github.com:Rat-OS/RatOS-configuration.git RatOS
cd ../..
```

Instalar dependencias
```bash
cd RatOS-configurator/src
pnpm install
```

Copia las constantes de entorno y define las rutas en .env.local
```bash
cp .env .env.local
cd ..
# Start vscode
code .
```

Edita .env.local y modifica las rutas para que coincidan con tu configuración, por ejemplo:
```
RATOS_CONFIGURATION_PATH=/home/myuser/RatOS-dev/printer_data/config/RatOS
KLIPPER_CONFIG_PATH=/home/myuser/RatOS-dev/printer_data/config
RATOS_SCRIPT_DIR=/home/myuser/RatOS-dev/RatOS-configurator/scripts
KLIPPER_DIR=/home/myuser/RatOS-dev/klipper
KLIPPER_ENV=/home/myuser/RatOS-dev/klippy-env
MOONRAKER_DIR=/home/myuser/RatOS-dev/moonraker
LOG_FILE=/home/myuser/RatOS-dev/printer_data/logs/ratos-configurator.log
RATOS_DATA_DIR=/home/myuser/RatOS-dev/printer_data/ratos
NEXT_PUBLIC_KLIPPER_HOSTNAME=hostnameofrunningtestprinter.local
RECOIL_DUPLICATE_ATOM_KEY_CHECKING_ENABLED=false
```

La variable `NEXT_PUBLIC_KLIPPER_HOSTNAME` es utilizada por el frontend para conectarse a moonraker y klipper, estos necesitan ser reales. El configurador RatOS guardará la configuración en la base de datos en la instancia de moonraker que se ejecuta en ese host.

Puedes intentar ejecutar klipper y moonraker localmente (aún no he explorado esta opción).

### (Opcional) vincular el binario cli de RatOS (los comandos solo funcionan cuando el servidor de desarrollo está en ejecución)
```bash
sudo ln -s "/home/myuser/RatOS-dev/RatOS-configurator/src/bin/ratos" "/usr/local/bin/ratos"
sudo chmod a+x "/usr/local/bin/ratos"
```
Ahora deberías poder ejecutar el comando `ratos` desde la línea de comandos.

### Desarrollo

en `RatOS-dev/RatOS-configurator/src` puedes ejecutar

* `pnpm run dev` para ejecutar el servidor de desarrollo
* `pnpm run test` para ejecutar las pruebas
* `pnpm run typecheck` para ejecutar la comprobación de tipos
* `pnpm run lint` para ejecutar el linting

## Ayuda y soporte

Por favor, utiliza el Discord no oficial de Rat Rig para ayuda y soporte. Solo crea un issue si has encontrado un error y puedes describir cómo reproducirlo, las solicitudes de funciones y las discusiones deben realizarse en el canal #ratos-development de Discord.

<a href="http://discord.gg/ratrig" target="_blank" rel="noopener noreferrer" style="margin-left: 5px;"><img src="https://img.shields.io/discord/582187371529764864?color=%235865F2&amp;label=discord&amp;logo=discord&amp;logoColor=white&amp;style=flat" alt="discord"></a>
