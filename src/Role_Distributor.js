
var Creep           = require('Creep');
var RoomHolder      = require('RoomHolder');
var Preference      = require('Preference');

// The distributor creep is dedicated to moving energy from spawn storage
// out to objects close to spawn -- extensions, spawns, towers, etc.
// Pretty much anything that needs energy except other containers.
// It has a focused body built on CARRY and MOVE and assumes it always has roads.


const BODY_M1 = [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
const BODY_M1_COST = 300;
const BODY_L7 = [CARRY, CARRY, CARRY, CARRY,CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
const BODY_L7_COST = 600;


class Role_Distributor extends Creep
{
    // Constructor to allocate creep (construct after it's spawn implicitly
    // by CreepMon)
    constructor (creep, crmem)
    {
        super(creep, crmem);
    };

    static spawn( spawn, hrObj ) {
        let room        = spawn.room;
        let controller  = room.controller;
        let body;
        let cost;
        let max;
        let altTime;

        // Bootstrappers will take care of energy distribution up to L3 and 10 extensions.
        if(controller.level < 3)
            return false;

        if(controller.level == 3) {
            let exten = hrObj.getExtensions();
            if(exten.length < 10)
                return false;
        }

        // Another prereq is that spawn storage is built.  Bootstrappers should
        // take care of this -- but not necessarily before the 10 extensions.
        let spStorage = hrObj.getSpawnContainer();
        if(!spStorage)
            return false;

        // 2x300E body seems to work well at least through L6.  When the room gets bigger
        // we'll see, but this does seem to fill about the right rate, and I suspect bigger
        // extensions will just mean more parts to spawn.
        //   Note - be careful dropping this below 300, as it acts as a recovery bootstrap
        // since at least 300 E will be generated by spawn in emergencies.
        body = BODY_M1;
        cost = BODY_M1_COST;

        if(controller.level >= 7){
            body = BODY_L7;
            cost = BODY_L7_COST;
        }
        max  = 2;
        altTime = (body.length*3)+10;

        // Wait for it, if not yet available
        if(room.energyAvailable < cost)
            return true;

        // Find a free name and spawn the bot.
        // For first room we'll boot a gazillion of them, so no
        // need for alt names or such.
        let crname = Creep.spawnCommon(spawn, 'distrib', body, max, altTime);

        // If null, max creeps are already spawned.
        if(crname == null)
            return false;

        let crmem  = Memory.creeps[crname];

        // Initialze memory for the role
        crmem.state = 'pickEnergy';

        return true;
    };


    // Logic callback invoked to have a creep run it's actions - derived from
    // base Creep class (a 'virtual function' or whatever you call it in JS).
	runLogic()
	{
	    let crmem = this.m_crmem;
	    let creep = this.m_creep;
	    let hRoom  = Game.rooms[crmem.homeName];
	    let hrObj  = RoomHolder.get(hRoom.name);
	    let rc;
	    let maxLoop = 5;
	    let exceed;
	    let si;
	    let debug="";
	    let dropped;
        let di;
        let drop;
        let spStorage;

	    for(exceed=0; exceed<maxLoop; exceed++){
            debug=debug + '\t loop'+exceed+' state='+crmem.state+'\n';

            //if(creep.name == 'distrib_E4N43_0')
            //    console.log(creep.name+'T='+Game.time+' loop='+exceed+' state='+crmem.state);

            switch(crmem.state){

            case 'pickEnergy':
                // Get storage or container nearest to spawns, if not built yet
                spStorage = hrObj.getSpawnContainer();
                if(!spStorage)
                    return false;

                // If there are dropped resources within range 6 of storage,
                // then go get it.
                let trm = hrObj.getTerminal();
                let sto = hrObj.getSpawnContainer();
                dropped = hrObj.getDroppedResources();
                if(dropped && dropped.length > 0){
                    for(di=0; di<dropped.length; di++){
                        drop = dropped[di];

                        // Skip pickup if resource is a simple reagent and
                        // We are over capacity
                        if(trm && drop.resourceType != RESOURCE_ENERGY
                           && drop.resourceType.length == 1
                           && trm.store[drop.resourceType] > 5000
                           && sto.store[drop.resourceType] > 15000)
                            continue;

                        // Skip pickup if good is on the production exclude list
                        if(Preference.prodExcludeList.indexOf(drop.resourceType) >= 0)
                            continue;

                        if(creep.pos.getRangeTo(drop.pos) <= 6 ){
                            this.setTarget(drop);
                            crmem.state = 'getDropped';
                            break;
                        }
                    }
                    if(di != dropped.length)
                        break;
                }

                // Else grab from whichever of storage or term is bigger.
                if(!trm || spStorage.store[RESOURCE_ENERGY] > trm.store[RESOURCE_ENERGY]*3){
                    this.setTarget(spStorage);
                    crmem.state = 'withdrawStruct';
                }
                else {
                    this.setTarget(trm);
                    crmem.state = 'withdrawStruct';
                }
                break;

            case 'withdrawStruct':
                rc=this.withdrawStruct(RESOURCE_ENERGY);
                if(rc == ERR_FULL){
                    crmem.state = 'pickFill';
                    break;
                }
                if(rc == OK)
                    return;
                crmem.state = 'pickEnergy';
                if(rc == ERR_NOT_ENOUGH_RESOURCES || rc == ERR_NO_PATH)
                    return;
                break;

            case 'getDropped':
                rc=this.pickupDropped(null);
                if(rc == ERR_FULL){
                    crmem.state = 'pickFill';
                    break;
                }
                if(rc == OK)
                    return;
                crmem.state = 'pickEnergy';
                if(rc == ERR_NOT_ENOUGH_RESOURCES || rc == ERR_NO_PATH)
                    return;
                break;

            case 'pickFill':

                if(_.sum(creep.carry) != creep.carry.energy){
                    this.setTarget(hrObj.getSpawnContainer())
                    crmem.state = 'fillStructure';
                    break;
                }

                // Check for very low towers < 50% first
                let towerList = hrObj.getTowers();
                let ti;
                let tower;
                for(ti=0; ti<towerList.length; ti++){
                    tower = towerList[ti];
                    if(tower.energy < (tower.energyCapacity/2)){
                        this.setTarget(tower);
                        break;
                    }
                }
                if(ti != towerList.length){
                    crmem.state = 'fillStructure';
                    break;
                }

                // Check if spawns need a fill
                let spawns = hrObj.getSpawns();
                let spawn = creep.pos.findClosestByPath
                        (spawns
                        ,   { filter: function (st)
                                {
                                    return (st.energy < st.energyCapacity);
                                }
                            }
                        );
                if(spawn){
                    this.setTarget(spawn);
                    crmem.state = 'fillStructure';
                    break;
                }

                // Check if any extensions need a fill
                let extenList = hrObj.getExtensions();
                let ei;
                let exten;
                exten = creep.pos.findClosestByPath
                        (extenList
                        ,   { filter: function (st)
                                {
                                    return (st.energy < st.energyCapacity);
                                }
                            }
                        );
                if(exten){
                    this.setTarget(exten);
                    crmem.state = 'fillStructure';
                    break;
                }

                // Take a secon look at towers going for 100%
                for(ti=0; ti<towerList.length; ti++){
                    tower = towerList[ti];
                    if(tower.energy < tower.energyCapacity){
                        this.setTarget(tower);
                        break;
                    }
                }
                if(ti != towerList.length){
                    crmem.state = 'fillStructure';
                    break;
                }

                // Otherwise nothing to do.  If we're carrying energy
                // and there are dropped resources in range, put what we're carrying
                // in storage, and go fetch.
                dropped = hrObj.getDroppedResources();

                if(dropped.length > 0 && creep.carry.energy > 0){
                    for(di=0; di<dropped.length; di++){
                        drop = dropped[di];
                        if(creep.pos.getRangeTo(drop.pos) <= 6 ){
                            this.setTarget(hrObj.getSpawnContainer());
                            crmem.state = 'fillStructure';
                            break;
                        }
                    }
                    if(di != dropped.length)
                        break;
                }

                // Otherwise if we're not full on energy, might as well get full.
                if(creep.carry.energy < creep.carryCapacity){
                    crmem.state = 'pickEnergy';
                    break;
                }

                // We have nothing to do and we're full on energy.
                // But we can optimistically start moving to where it'll be
                // needed first -- next to the top left spawn is fairly free,
                // a few moves away -- and the first place energy will disappear
                let tls = hrObj.findTopLeftSpawn();
                if(!tls)
                    return;
                if (crmem.instance == 0){
                    this.actMoveTo(tls.pos.x, tls.pos.y-1);
                }
                else {
                    // And the other to just left of the "south" road.
                    this.actMoveTo(tls.pos.x-1, tls.pos.y);
                }

                return;

            case 'fillStructure':
                rc=this.fillTarget(null);
                debug=debug + '\t ..rc='+rc+'\n';

                if(rc == OK)
                    return;
                else if(rc == ERR_NOT_ENOUGH_RESOURCES){
                    crmem.state = 'pickEnergy';
                    break;
                }
                else if(rc == ERR_FULL){
                    crmem.state = 'pickFill';
                    break;
                }
                else
                    console.log(creep.name+' fillTarget rc='+rc+' target='+this.getTarget());

                if(creep.carry.energy < 50){
                    crmem.state = 'pickEnergy';
                    break;
                }
                crmem.state = 'pickFill';
                break;

            default:
                console.log('BUG! Unrecognized creep state='+crmem.state+' for creep='+creep.name);
                crmem.state = 'pickEnergy';
                break;
            }
	    }
	    if(exceed == maxLoop)
	        console.log('BUG! '+creep.name+' exceeded max loops\n'+debug);
	}
}

module.exports = Role_Distributor;
